import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/lib/db";
import { automationLimits, evaluateInactiveLeads, runAutomations } from "../../src/lib/automation/engine";
import { notifyOnce } from "../../src/lib/notifications";
import { actAs, call, createTenant, destroyTenant, installSessionMock, type Tenant } from "../helpers/http";

/**
 * AUTO-003 / SEC-011 / AUTO-005: CREATE_TASK and NOTIFY are idempotent per (automation, action, event);
 * retries, replays and concurrent duplicates cannot repeat them. Execution is bounded (per-action
 * timeout, action cap, time budget). Also TEST-004: concurrency for automation side effects.
 */
describe("Automation side effects are idempotent per event", () => {
  let tenant: Tenant;
  let leadId: string;

  before(async () => {
    tenant = await createTenant("autoidem");
    const lead = await prisma.lead.create({ data: { workspaceId: tenant.workspaceId, firstName: "Idem", ownerId: tenant.users.AGENT.id } });
    leadId = lead.id;
    await prisma.automation.create({
      data: {
        workspaceId: tenant.workspaceId,
        name: "task + notify",
        trigger: "STAGE_CHANGED",
        enabled: true,
        paused: false,
        actions: [
          { type: "CREATE_TASK", title: "Do thing", priority: "LOW", dueInDays: 1 },
          { type: "NOTIFY", title: "Heads up", notifyType: "HIGH_VALUE_LEAD" },
        ],
      },
    });
  });

  after(async () => {
    await destroyTenant(tenant);
  });

  const fire = (eventKey?: string) =>
    runAutomations({ workspaceId: tenant.workspaceId, actorId: null, trigger: "STAGE_CHANGED", leadId, eventKey });
  const counts = async () => ({
    tasks: await prisma.task.count({ where: { workspaceId: tenant.workspaceId, leadId } }),
    notifications: await prisma.notification.count({ where: { workspaceId: tenant.workspaceId, title: { in: ["Heads up", "Do thing"] } } }),
  });
  const reset = async () => {
    await prisma.task.deleteMany({ where: { workspaceId: tenant.workspaceId } });
    await prisma.notification.deleteMany({ where: { workspaceId: tenant.workspaceId } });
  };

  it("the same eventKey twice creates one task and one notification; the replay is recorded as SKIPPED", async () => {
    await reset();
    const first = await fire("ev-1");
    const second = await fire("ev-1");
    assert.deepEqual(first.map((r) => r.status), ["SUCCESS", "SUCCESS"]);
    assert.deepEqual(second.map((r) => r.status), ["SKIPPED", "SKIPPED"]);
    assert.deepEqual(await counts(), { tasks: 1, notifications: 2 }, "1 task + (task notification + NOTIFY action)");
    assert.equal(second.every((r) => "result" in r && r.result === "skipped:duplicate"), true);
  });

  it("different events are independent, and an event without a key is never deduplicated", async () => {
    await reset();
    await fire("ev-a");
    await fire("ev-b");
    assert.equal((await counts()).tasks, 2);
    await fire();
    await fire();
    assert.equal((await counts()).tasks, 4, "keyless triggers are genuine new occurrences");
  });

  it("concurrent duplicate triggers produce one task and one notification", async () => {
    for (let round = 0; round < 4; round++) {
      await reset();
      await Promise.all(Array.from({ length: 6 }, () => fire(`race-${round}`)));
      assert.deepEqual(await counts(), { tasks: 1, notifications: 2 }, `round ${round}`);
    }
  });

  it("two automations with the same action on one event each keep their own key", async () => {
    await reset();
    await prisma.automation.create({
      data: { workspaceId: tenant.workspaceId, name: "second rule", trigger: "STAGE_CHANGED", enabled: true, paused: false, actions: [{ type: "CREATE_TASK", title: "Second", priority: "LOW", dueInDays: 1 }] },
    });
    await fire("ev-multi");
    await fire("ev-multi");
    assert.equal((await counts()).tasks, 2, "one task per automation, not per event");
    await prisma.automation.deleteMany({ where: { workspaceId: tenant.workspaceId, name: "second rule" } });
  });

  it("notifyOnce returns null for a repeated key and never throws", async () => {
    const input = { workspaceId: tenant.workspaceId, userId: tenant.users.OWNER.id, type: "HIGH_VALUE_LEAD" as const, title: "x", dedupeKey: "k-1" };
    assert.ok(await notifyOnce(input));
    assert.equal(await notifyOnce(input), null);
    assert.ok(await notifyOnce({ ...input, dedupeKey: "k-2" }));
  });
});

describe("Retried HTTP requests do not repeat automation effects", () => {
  let tenant: Tenant;

  before(async () => {
    installSessionMock();
    tenant = await createTenant("autohttp");
    actAs(tenant.users.AGENT);
    await prisma.automation.create({
      data: { workspaceId: tenant.workspaceId, name: "proposal sent", trigger: "PROPOSAL_SENT", enabled: true, paused: false, actions: [{ type: "CREATE_TASK", title: "Follow up on proposal", priority: "HIGH", dueInDays: 3 }] },
    });
    await prisma.automation.create({
      data: { workspaceId: tenant.workspaceId, name: "lead created", trigger: "LEAD_CREATED", enabled: true, paused: false, actions: [{ type: "CREATE_TASK", title: "Contact new lead", priority: "HIGH", dueInDays: 1 }] },
    });
  });

  after(async () => {
    await destroyTenant(tenant);
  });

  it("a proposal marked SENT by two simultaneous requests creates one follow-up task", async () => {
    const { PATCH } = await import("../../src/app/api/proposals/[id]/route");
    const proposal = await prisma.proposal.create({ data: { workspaceId: tenant.workspaceId, proposalNumber: `P-${Date.now()}`, value: 1 } });
    const results = await Promise.all([1, 2, 3].map(() => call(PATCH, "PATCH", { params: { id: proposal.id }, body: { status: "SENT" } })));
    assert.ok(results.every((r) => r.status === 200), JSON.stringify(results.map((r) => r.status)));
    assert.equal(await prisma.task.count({ where: { workspaceId: tenant.workspaceId, proposalId: proposal.id } }), 1);
  });

  it("a completed site visit submitted twice at once creates one next-step task", async () => {
    await prisma.automation.create({
      data: { workspaceId: tenant.workspaceId, name: "visit done", trigger: "SITE_VISIT_COMPLETED", enabled: true, paused: false, actions: [{ type: "CREATE_TASK", title: "Log visit notes", priority: "HIGH", dueInDays: 1 }] },
    });
    const { PATCH } = await import("../../src/app/api/calendar/[id]/route");
    const event = await prisma.calendarEvent.create({
      data: { workspaceId: tenant.workspaceId, title: "Visit", type: "SITE_VISIT", startAt: new Date(), endAt: new Date(Date.now() + 3600_000) },
    });
    const results = await Promise.all([1, 2].map(() => call(PATCH, "PATCH", { params: { id: event.id }, body: { status: "COMPLETED" } })));
    assert.ok(results.every((r) => r.status === 200));
    assert.equal(await prisma.task.count({ where: { workspaceId: tenant.workspaceId, siteVisitId: event.id } }), 1);
  });

  it("creating a lead fires the LEAD_CREATED task once", async () => {
    const { POST } = await import("../../src/app/api/leads/route");
    const res = await call(POST, "POST", { body: { firstName: "Fresh" } });
    assert.equal(res.status, 201);
    assert.equal(await prisma.task.count({ where: { workspaceId: tenant.workspaceId, leadId: res.body.id } }), 1);
  });
});

describe("Bounded automation execution (AUTO-005)", () => {
  let tenant: Tenant;
  const saved = { ...automationLimits };

  before(async () => {
    tenant = await createTenant("autobound");
  });

  after(async () => {
    Object.assign(automationLimits, saved);
    await destroyTenant(tenant);
  });

  it("a hung action is cut off, recorded FAILED with a timeout error, and does not stop later actions", async (t) => {
    const lead = await prisma.lead.create({ data: { workspaceId: tenant.workspaceId, firstName: "Slow" } });
    const automation = await prisma.automation.create({
      data: {
        workspaceId: tenant.workspaceId,
        name: "slow",
        trigger: "LEAD_CREATED",
        enabled: true,
        paused: false,
        actions: [
          { type: "CREATE_TASK", title: "Hangs", priority: "LOW", dueInDays: 1 },
          { type: "NOTIFY", title: "Still runs", notifyType: "HIGH_VALUE_LEAD" },
        ],
      },
    });
    automationLimits.actionTimeoutMs = 100;
    // A genuinely slow INSERT (1s) on this workspace's tasks, so CREATE_TASK exceeds the 100ms budget.
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION slow_task_fn() RETURNS trigger AS $$
      BEGIN IF NEW."workspaceId" = '${tenant.workspaceId}' THEN PERFORM pg_sleep(1); END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe('CREATE TRIGGER slow_task BEFORE INSERT ON "Task" FOR EACH ROW EXECUTE FUNCTION slow_task_fn()');
    t.after(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1300)); // let the abandoned insert finish before cleanup
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS slow_task ON "Task"');
    });
    const started = Date.now();
    const results = await runAutomations({ workspaceId: tenant.workspaceId, actorId: null, trigger: "LEAD_CREATED", leadId: lead.id }, [automation]);
    assert.ok(Date.now() - started < 3000, "returned promptly instead of hanging");
    assert.equal(results[0].status, "FAILED");
    assert.match((results[0] as { error: string }).error, /timed out after 100ms/);
    assert.equal(results.length, 2, "the second action still ran");
  });

  it("caps the number of actions run for one event", async (t) => {
    t.mock.method(console, "error", () => {});
    const lead = await prisma.lead.create({ data: { workspaceId: tenant.workspaceId, firstName: "Many" } });
    const automation = await prisma.automation.create({
      data: {
        workspaceId: tenant.workspaceId,
        name: "many",
        trigger: "LEAD_QUALIFIED",
        enabled: true,
        paused: false,
        actions: Array.from({ length: 8 }, (_, i) => ({ type: "CREATE_TASK", title: `T${i}`, priority: "LOW", dueInDays: 1 })),
      },
    });
    Object.assign(automationLimits, saved, { maxActionsPerEvent: 3 });
    const results = await runAutomations({ workspaceId: tenant.workspaceId, actorId: null, trigger: "LEAD_QUALIFIED", leadId: lead.id }, [automation]);
    assert.equal(results.length, 3);
    assert.equal(await prisma.task.count({ where: { workspaceId: tenant.workspaceId, leadId: lead.id } }), 3);
    Object.assign(automationLimits, saved);
  });

  it("the inactive-lead sweep stops at its time budget, flags truncation, and the next run finishes the rest", async () => {
    await prisma.automation.create({
      data: { workspaceId: tenant.workspaceId, name: "inactive", trigger: "LEAD_INACTIVE", enabled: true, paused: false, actions: [{ type: "CREATE_TASK", title: "Re-engage", priority: "LOW", dueInDays: 1 }] },
    });
    const stale = new Date(Date.now() - 60 * 86400000);
    const ids = (
      await Promise.all(Array.from({ length: 6 }, (_, i) => prisma.lead.create({ data: { workspaceId: tenant.workspaceId, firstName: `Stale${i}`, stage: "CONTACTED", lastActivityAt: stale } })))
    ).map((l) => l.id);
    const state = { truncated: false };
    await evaluateInactiveLeads(tenant.workspaceId, null, { deadlineMs: -1, state }); // budget already spent
    assert.equal(state.truncated, true);
    assert.equal(await prisma.task.count({ where: { workspaceId: tenant.workspaceId, leadId: { in: ids } } }), 0, "nothing started past the deadline");
    await evaluateInactiveLeads(tenant.workspaceId, null, { deadlineMs: 60_000, state: { truncated: false } });
    assert.equal(await prisma.task.count({ where: { workspaceId: tenant.workspaceId, leadId: { in: ids } } }), 6);
  });
});
