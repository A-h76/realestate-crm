import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import type { Automation, Prisma } from "@prisma/client";
import { prisma } from "../../src/lib/db";
import { runAutomations } from "../../src/lib/automation/engine";

/**
 * Design A1 (CSV import performance): removed the AutomationExecution RUNNING
 * pre-insert in favor of one write after the action's real outcome is known,
 * and added an optional audit buffer so CSV import can flush one
 * `auditLog.createMany()` instead of one row per lead-action. These tests
 * cover the behavior that change must preserve (status/timestamp/failure
 * semantics, audit contract) and Finding F1 (a bookkeeping write failing must
 * never be reported as the automation — or the already-committed lead import
 * — having failed).
 */
describe("CSV-triggered automation execution (Design A1)", () => {
  let workspaceId: string;

  before(async () => {
    const workspace = await prisma.workspace.create({
      data: { name: "CSV Automation Test", slug: `csv-auto-test-${randomUUID()}` },
    });
    workspaceId = workspace.id;
  });

  after(async () => {
    await prisma.workspace.delete({ where: { id: workspaceId } });
  });

  async function createAutomation(): Promise<Automation> {
    return prisma.automation.create({
      data: {
        workspaceId,
        name: "Lead created -> create task",
        trigger: "LEAD_CREATED",
        enabled: true,
        paused: false,
        actions: [{ type: "CREATE_TASK", title: "Contact new lead", priority: "HIGH", dueInDays: 1 }],
      },
    });
  }

  async function createLead() {
    return prisma.lead.create({ data: { workspaceId, firstName: "Test", lastName: "Lead" } });
  }

  it("existing success path: writes one SUCCESS execution row and the expected audit rows", async () => {
    const automation = await createAutomation();
    const lead = await createLead();
    const before = new Date();

    const results = await runAutomations({ workspaceId, actorId: null, trigger: "LEAD_CREATED", leadId: lead.id }, [
      automation,
    ]);

    assert.equal(results.length, 1);
    const row = results[0];
    assert.ok(!("persisted" in row), "expected a real persisted AutomationExecution row");
    assert.equal(row.status, "SUCCESS");
    assert.equal(row.retryCount, 0);
    assert.ok(row.result?.startsWith("task:"));
    assert.ok(row.durationMs !== null && row.durationMs >= 0);
    // createdAt must reflect when the action *started*, not some later write time.
    assert.ok(row.createdAt.getTime() >= before.getTime());

    const task = await prisma.task.findFirst({ where: { workspaceId, leadId: lead.id } });
    assert.ok(task, "CREATE_TASK must still create a real Task");

    const taskAudit = await prisma.auditLog.findFirst({
      where: { workspaceId, action: "TASK_CREATED", entityId: task!.id },
    });
    assert.ok(taskAudit, "TASK_CREATED audit must be written when no auditBuffer is supplied");

    const execAudit = await prisma.auditLog.findFirst({
      where: { workspaceId, action: "AUTOMATION_EXECUTED", entityId: row.id },
    });
    assert.ok(execAudit, "AUTOMATION_EXECUTED audit must be written when no auditBuffer is supplied");
  });

  it("automation (action) failure: persists a FAILED row with error/retryCount, never throws", async () => {
    const automation = await createAutomation();

    // leadId references a non-existent Lead -> Task.leadId FK violation -> executeAction rejects.
    const results = await runAutomations(
      { workspaceId, actorId: null, trigger: "LEAD_CREATED", leadId: "lead_does_not_exist" },
      [automation],
    );

    assert.equal(results.length, 1);
    const row = results[0];
    assert.ok(!("persisted" in row));
    assert.equal(row.status, "FAILED");
    assert.equal(row.retryCount, 1);
    assert.ok(row.error && row.error.length > 0);

    const failedAudit = await prisma.auditLog.findFirst({
      where: { workspaceId, action: "AUTOMATION_FAILED", entityId: row.id },
    });
    assert.ok(failedAudit, "AUTOMATION_FAILED audit must still be written");
    const metadata = failedAudit!.metadata as Record<string, unknown>;
    assert.equal(metadata.action, "CREATE_TASK");
  });

  it("Finding F1: an AutomationExecution persist failure never claims success and never throws", async (t) => {
    const errors: unknown[][] = [];
    t.mock.method(console, "error", (...args: unknown[]) => {
      errors.push(args);
    });

    const real = await createAutomation();
    const lead = await createLead();
    // A valid-looking Automation whose id does not exist in the DB: executeAction (CREATE_TASK)
    // succeeds for real (the lead is real), but the AutomationExecution insert hits a foreign-key
    // violation on automationId. This must surface as "persisted: false, status: SUCCESS", never
    // as a false success record and never as a thrown error that would abort the CSV batch.
    const ghost: Automation = { ...real, id: "automation_does_not_exist" };

    const results = await runAutomations({ workspaceId, actorId: null, trigger: "LEAD_CREATED", leadId: lead.id }, [
      ghost,
    ]);

    assert.equal(results.length, 1);
    const row = results[0];
    assert.ok("persisted" in row && row.persisted === false, "must report the persist failure, not a real row");
    assert.equal(row.status, "SUCCESS", "the action itself genuinely succeeded");
    assert.equal(row.automationId, "automation_does_not_exist");
    assert.equal(row.actionType, "CREATE_TASK");

    // The task really was created — the import's actual side effect is not rolled back or lost.
    const task = await prisma.task.findFirst({ where: { workspaceId, leadId: lead.id } });
    assert.ok(task);

    // No AutomationExecution row exists for the ghost automation (the insert failed) — confirming
    // we did not silently fabricate one.
    const execRows = await prisma.automationExecution.count({ where: { workspaceId, automationId: ghost.id } });
    assert.equal(execRows, 0);

    // The failure was diagnosed, not swallowed.
    assert.ok(errors.some((args) => String(args[0]).includes('"event":"automation_execution_persist_failed"')));
  });

  it("audit batching: with an auditBuffer, rows are queued in memory and only persisted on explicit flush", async () => {
    const automation = await createAutomation();
    const lead = await createLead();
    const auditBuffer: Prisma.AuditLogCreateManyInput[] = [];

    const results = await runAutomations(
      { workspaceId, actorId: null, trigger: "LEAD_CREATED", leadId: lead.id },
      [automation],
      auditBuffer,
    );
    const row = results[0];
    assert.ok(!("persisted" in row));

    // Not yet written to the database — only queued.
    const beforeFlush = await prisma.auditLog.count({ where: { workspaceId, entityId: row.id } });
    assert.equal(beforeFlush, 0);
    assert.ok(auditBuffer.some((a) => a.action === "AUTOMATION_EXECUTED" && a.entityId === row.id));

    await prisma.auditLog.createMany({ data: auditBuffer });

    const afterFlush = await prisma.auditLog.findFirst({
      where: { workspaceId, action: "AUTOMATION_EXECUTED", entityId: row.id },
    });
    assert.ok(afterFlush);
    const metadata = afterFlush!.metadata as Record<string, unknown>;
    assert.equal(metadata.trigger, "LEAD_CREATED");
    assert.equal(metadata.action, "CREATE_TASK");
  });

  it("duplicate imports: re-running automations for the same lead never throws (pre-existing, unchanged)", async () => {
    const automation = await createAutomation();
    const lead = await createLead();

    const first = await runAutomations({ workspaceId, actorId: null, trigger: "LEAD_CREATED", leadId: lead.id }, [
      automation,
    ]);
    const second = await runAutomations({ workspaceId, actorId: null, trigger: "LEAD_CREATED", leadId: lead.id }, [
      automation,
    ]);

    assert.equal(first.length, 1);
    assert.equal(second.length, 1);

    // Documented, not fixed by A1: automations are not deduped per lead, so a retried batch
    // creates a second Task/AutomationExecution. This is an existing gap (see the CSV design
    // review), not a regression introduced here.
    const taskCount = await prisma.task.count({ where: { workspaceId, leadId: lead.id } });
    const execCount = await prisma.automationExecution.count({ where: { workspaceId, leadId: lead.id } });
    assert.equal(taskCount, 2);
    assert.equal(execCount, 2);
  });
});
