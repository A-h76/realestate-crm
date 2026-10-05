import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/lib/db";
import { evaluateInactiveLeads } from "../../src/lib/automation/engine";

/**
 * AUTO-002: this is what a daily Railway Cron Job actually calls (via
 * scripts/run-inactive-lead-automations.ts, one call per workspace). Covers
 * the two things that make it safe to run unattended on a schedule: it finds
 * the inactive lead at all, and it does NOT re-action the same lead on the
 * next run within the cutoff window.
 */
describe("evaluateInactiveLeads (scheduler entry point)", () => {
  let workspaceId: string;

  before(async () => {
    const workspace = await prisma.workspace.create({
      data: { name: "Inactive Lead Scheduler Test", slug: `inactive-lead-test-${randomUUID()}` },
    });
    workspaceId = workspace.id;
    await prisma.automation.create({
      data: {
        workspaceId,
        name: "Lead inactive → follow-up",
        trigger: "LEAD_INACTIVE",
        enabled: true,
        paused: false,
        actions: [{ type: "CREATE_TASK", title: "Re-engage", priority: "MEDIUM", dueInDays: 1 }],
      },
    });
  });

  after(async () => {
    await prisma.workspace.delete({ where: { id: workspaceId } });
  });

  it("actions a lead inactive past the cutoff, then skips it on the next run", async () => {
    const staleDate = new Date(Date.now() - 20 * 86400000);
    const lead = await prisma.lead.create({
      data: { workspaceId, firstName: "Stale", lastName: "Lead", stage: "CONTACTED", lastActivityAt: staleDate },
    });

    const firstRun = await evaluateInactiveLeads(workspaceId, null);
    assert.ok(firstRun.length > 0, "expected at least one automation execution on the first run");

    const taskCountAfterFirst = await prisma.task.count({ where: { workspaceId, leadId: lead.id } });
    assert.equal(taskCountAfterFirst, 1);

    // Simulating the next day's cron run: the lead is still inactive (nothing
    // touched lastActivityAt), but it must not get a second task.
    const secondRun = await evaluateInactiveLeads(workspaceId, null);
    assert.equal(secondRun.length, 0, "expected the second run to skip an already-actioned lead");

    const taskCountAfterSecond = await prisma.task.count({ where: { workspaceId, leadId: lead.id } });
    assert.equal(taskCountAfterSecond, 1);
  });

  it("ignores leads that are not actually inactive", async () => {
    await prisma.lead.create({
      data: { workspaceId, firstName: "Active", lastName: "Lead", stage: "NEW", lastActivityAt: new Date() },
    });
    const results = await evaluateInactiveLeads(workspaceId, null);
    assert.equal(results.length, 0);
  });

  it("while another run holds the workspace lock, a run does nothing; once released it acts exactly once", async () => {
    const lead = await prisma.lead.create({
      data: { workspaceId, firstName: "Race", lastName: "Lead", stage: "CONTACTED", lastActivityAt: new Date(Date.now() - 30 * 86400000) },
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let acquired!: () => void;
    const lockTaken = new Promise<void>((resolve) => (acquired = resolve));
    // Simulates a concurrent cron run / second app instance / manual trigger mid-evaluation.
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`inactive-leads:${workspaceId}`}))`;
        acquired();
        await held;
      },
      { timeout: 30_000 },
    );
    await lockTaken;
    try {
      assert.equal((await evaluateInactiveLeads(workspaceId, null)).length, 0, "must back off while locked");
      assert.equal(await prisma.task.count({ where: { workspaceId, leadId: lead.id } }), 0);
    } finally {
      release();
      await holder;
    }
    assert.ok((await evaluateInactiveLeads(workspaceId, null)).length > 0);
    assert.equal(await prisma.task.count({ where: { workspaceId, leadId: lead.id } }), 1);
    assert.equal((await evaluateInactiveLeads(workspaceId, null)).length, 0);
    assert.equal(await prisma.task.count({ where: { workspaceId, leadId: lead.id } }), 1);
  });

  it("a lead whose earlier action FAILED is retried on the next run", async () => {
    const automation = await prisma.automation.findFirstOrThrow({ where: { workspaceId, trigger: "LEAD_INACTIVE" } });
    const lead = await prisma.lead.create({
      data: { workspaceId, firstName: "Retry", lastName: "Lead", stage: "CONTACTED", lastActivityAt: new Date(Date.now() - 40 * 86400000) },
    });
    await prisma.automationExecution.create({
      data: { workspaceId, automationId: automation.id, trigger: "LEAD_INACTIVE", leadId: lead.id, action: "CREATE_TASK", status: "FAILED", error: "boom" },
    });
    await evaluateInactiveLeads(workspaceId, null);
    assert.equal(await prisma.task.count({ where: { workspaceId, leadId: lead.id } }), 1);
  });

  it("never actions converted, lost or archived leads", async () => {
    const stale = new Date(Date.now() - 50 * 86400000);
    const ids: string[] = [];
    for (const stage of ["CONVERTED", "LOST", "ARCHIVED"] as const) {
      ids.push((await prisma.lead.create({ data: { workspaceId, firstName: stage, stage, lastActivityAt: stale } })).id);
    }
    await evaluateInactiveLeads(workspaceId, null);
    assert.equal(await prisma.task.count({ where: { workspaceId, leadId: { in: ids } } }), 0);
  });

  it("a paused automation is never run by the scheduler", async () => {
    const other = await prisma.workspace.create({ data: { name: "Paused", slug: `paused-${randomUUID()}` } });
    try {
      await prisma.automation.create({
        data: { workspaceId: other.id, name: "paused", trigger: "LEAD_INACTIVE", enabled: true, paused: true, actions: [{ type: "CREATE_TASK", title: "x", priority: "LOW", dueInDays: 1 }] },
      });
      await prisma.lead.create({ data: { workspaceId: other.id, firstName: "P", stage: "NEW", lastActivityAt: new Date(Date.now() - 50 * 86400000) } });
      assert.equal((await evaluateInactiveLeads(other.id, null)).length, 0);
      assert.equal(await prisma.task.count({ where: { workspaceId: other.id } }), 0);
    } finally {
      await prisma.workspace.delete({ where: { id: other.id } });
    }
  });
});
