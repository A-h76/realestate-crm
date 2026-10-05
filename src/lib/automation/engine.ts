import { Prisma, type Automation, type AutomationTrigger } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { analyzeLead } from "@/lib/ai/lead-analysis";
import { explainPropertyMatches } from "@/lib/ai/property-match";
import { notify, notifyOnce } from "@/lib/notifications";
import { scoreLead } from "@/lib/scoring/score-lead";
import { logEvent } from "@/lib/log";
import { measureExecution } from "@/lib/perf";

export type AutomationEvent = {
  workspaceId: string;
  actorId?: string | null;
  trigger: AutomationTrigger;
  leadId?: string | null;
  opportunityId?: string | null;
  payload?: Record<string, unknown>;
  /**
   * Stable identity of the real-world event (e.g. `lead-created:<id>`). When present, CREATE_TASK and
   * NOTIFY actions are idempotent for it: a retry, replay or concurrent duplicate trigger creates the
   * task/notification at most once (DB unique index on dedupeKey). Omit it only where every trigger
   * is genuinely a new occurrence.
   */
  eventKey?: string;
};

/** Bounds for one synchronous run (AUTO-005). Mutable only so tests can lower them. */
export const automationLimits = { actionTimeoutMs: 20_000, maxActionsPerEvent: 50 };

/** UTC day, for "at most once per lead per day" event keys. */
export function dayBucket(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Automation action timed out after ${ms}ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

const DUPLICATE_RESULT = "skipped:duplicate";

type ActionDef = {
  type: string;
  title?: string;
  description?: string;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  dueInDays?: number;
  notifyType?: "PROPOSAL_VIEWED" | "HIGH_VALUE_LEAD" | "FOLLOW_UP_CREATED" | "PROPERTY_MATCH_FOUND";
};

function asActions(value: Prisma.JsonValue): ActionDef[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is ActionDef => Boolean(row && typeof row === "object" && "type" in row));
}

function conditionsPass(automation: Automation, event: AutomationEvent) {
  const conditions = automation.conditions;
  if (!conditions || typeof conditions !== "object" || Array.isArray(conditions)) return true;
  const c = conditions as Record<string, unknown>;
  if (typeof c.minScore === "number") {
    const score = Number(event.payload?.leadScore ?? 0);
    if (score < c.minScore) return false;
  }
  if (typeof c.minMatch === "number") {
    const match = Number(event.payload?.matchScore ?? 0);
    if (match < c.minMatch) return false;
  }
  return true;
}

async function ownerFor(event: AutomationEvent) {
  if (event.leadId) {
    const lead = await prisma.lead.findFirst({
      where: { id: event.leadId, workspaceId: event.workspaceId },
      select: { ownerId: true },
    });
    if (lead?.ownerId) return lead.ownerId;
  }
  if (event.opportunityId) {
    const opp = await prisma.opportunity.findFirst({
      where: { id: event.opportunityId, workspaceId: event.workspaceId },
      select: { ownerId: true },
    });
    if (opp?.ownerId) return opp.ownerId;
  }
  return event.actorId ?? null;
}

/**
 * Writes one audit row. When `buffer` is supplied (CSV import's per-row loop), the row is queued
 * in memory instead of written immediately, so the caller can flush the whole batch with one
 * `auditLog.createMany()` instead of one round trip per row. Every other caller omits `buffer`
 * and gets today's exact behavior: an immediate, individual `writeAudit`.
 */
async function recordAudit(
  buffer: Prisma.AuditLogCreateManyInput[] | undefined,
  input: Parameters<typeof writeAudit>[0],
): Promise<void> {
  if (buffer) {
    buffer.push({
      workspaceId: input.workspaceId,
      actorId: input.actorId ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      metadata: input.metadata,
      createdAt: new Date(),
    });
    return;
  }
  await writeAudit(input);
}

async function executeAction(
  event: AutomationEvent,
  action: ActionDef,
  auditBuffer: Prisma.AuditLogCreateManyInput[] | undefined,
  dedupeKey: string | null,
) {
  const ownerId = await ownerFor(event);
  const due = new Date();
  due.setDate(due.getDate() + (action.dueInDays ?? 1));

  switch (action.type) {
    case "CREATE_TASK": {
      const proposalId =
        typeof event.payload?.proposalId === "string" ? event.payload.proposalId : null;
      const proposalNumber =
        typeof event.payload?.proposalNumber === "string" ? event.payload.proposalNumber : null;
      const siteVisitId =
        typeof event.payload?.siteVisitId === "string" ? event.payload.siteVisitId : null;
      const title =
        action.title && proposalNumber ? `${action.title} ${proposalNumber}` : (action.title ?? "Follow up");
      let task: Awaited<ReturnType<typeof prisma.task.create>>;
      try {
        task = await prisma.task.create({
        data: {
          workspaceId: event.workspaceId,
          title,
          description: action.description ?? "Created by automation.",
          status: "TODO",
          priority: action.priority ?? "MEDIUM",
          dueAt: due,
          ownerId,
          leadId: event.leadId ?? null,
          opportunityId: event.opportunityId ?? null,
          proposalId,
          siteVisitId,
          dedupeKey,
        },
      });
      } catch (error) {
        if (dedupeKey && isUniqueViolation(error)) return DUPLICATE_RESULT;
        throw error;
      }
      await recordAudit(auditBuffer, {
        workspaceId: event.workspaceId,
        actorId: event.actorId,
        action: "TASK_CREATED",
        entity: "Task",
        entityId: task.id,
        metadata: { automation: true, trigger: event.trigger },
      });
      if (ownerId) {
        await notify({
          workspaceId: event.workspaceId,
          userId: ownerId,
          type: "FOLLOW_UP_CREATED",
          title: task.title,
          body: action.description,
          href: event.leadId ? `/leads/${event.leadId}` : event.opportunityId ? `/opportunities/${event.opportunityId}` : "/tasks",
          entityType: "Task",
          entityId: task.id,
        });
      }
      return `task:${task.id}`;
    }
    case "RUN_AI_ANALYSIS": {
      if (!event.leadId) return "skipped:no-lead";
      const result = await analyzeLead({
        workspaceId: event.workspaceId,
        leadId: event.leadId,
        actorId: event.actorId,
      });
      return result ? `analysis:${result.run.id}` : "skipped:missing-lead";
    }
    case "RUN_SCORING": {
      if (!event.leadId) return "skipped:no-lead";
      const result = await scoreLead({
        workspaceId: event.workspaceId,
        leadId: event.leadId,
        actorId: event.actorId,
      });
      return result ? `score:${result.lead.leadScore}` : "skipped:missing-lead";
    }
    case "RUN_PROPERTY_MATCH": {
      if (!event.leadId) return "skipped:no-lead";
      const result = await explainPropertyMatches({
        workspaceId: event.workspaceId,
        leadId: event.leadId,
        actorId: event.actorId,
      });
      const best = result?.scored[0];
      if (best && best.matchScore >= 80 && ownerId) {
        await notify({
          workspaceId: event.workspaceId,
          userId: ownerId,
          type: "PROPERTY_MATCH_FOUND",
          title: `${best.matchScore}% property match`,
          body: best.property.title,
          href: `/leads/${event.leadId}`,
          entityType: "Property",
          entityId: best.property.id,
        });
      }
      return best ? `match:${best.matchScore}` : "match:none";
    }
    case "NOTIFY": {
      if (!ownerId) return "skipped:no-owner";
      const payload = {
        workspaceId: event.workspaceId,
        userId: ownerId,
        type: action.notifyType ?? "HIGH_VALUE_LEAD",
        title: action.title ?? "Attention required",
        body: action.description,
        href: event.leadId ? `/leads/${event.leadId}` : event.opportunityId ? `/opportunities/${event.opportunityId}` : "/dashboard",
        entityType: event.opportunityId ? "Opportunity" : "Lead",
        entityId: event.opportunityId ?? event.leadId ?? undefined,
      };
      const n = dedupeKey ? await notifyOnce({ ...payload, dedupeKey }) : await notify(payload);
      return n ? `notification:${n.id}` : DUPLICATE_RESULT;
    }
    default:
      return `skipped:unknown:${action.type}`;
  }
}

/** A row the engine could not persist. The action's real outcome (`status`) is still carried —
 * it is never upgraded to a false SUCCESS just because the bookkeeping write failed (Finding F1). */
export type UnpersistedAutomationResult = {
  persisted: false;
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  automationId: string;
  actionType: string;
  leadId: string | null;
  opportunityId: string | null;
};

type AutomationResult = Awaited<ReturnType<typeof prisma.automationExecution.create>> | UnpersistedAutomationResult;

function logPersistFailure(context: Record<string, unknown>, error: unknown) {
  logEvent("error", "automation_execution_persist_failed", { ...context, error });
}

/**
 * `preloaded`: skip the automations lookup for callers that already fetched the
 * same (workspaceId, trigger) rule set — e.g. a batch loop invoking this once per
 * row would otherwise re-run an identical findMany on every iteration (measured:
 * 500-row CSV import spent ~3.5s mostly on this redundant query, see perf-http.ts).
 *
 * `auditBuffer`: see `recordAudit` — passed through by CSV import to batch audit writes.
 */
export async function runAutomations(
  event: AutomationEvent,
  preloaded?: Automation[],
  auditBuffer?: Prisma.AuditLogCreateManyInput[],
) {
  return measureExecution(`automation.${event.trigger}`, async () => {
  const automations = preloaded ?? await prisma.automation.findMany({
    where: {
      workspaceId: event.workspaceId,
      trigger: event.trigger,
      enabled: true,
      paused: false,
    },
  });

  const results: AutomationResult[] = [];
  for (const automation of automations) {
    if (!conditionsPass(automation, event)) {
      try {
        const skipped = await prisma.automationExecution.create({
          data: {
            workspaceId: event.workspaceId,
            automationId: automation.id,
            trigger: event.trigger,
            leadId: event.leadId ?? null,
            opportunityId: event.opportunityId ?? null,
            action: "conditions",
            result: "Conditions not met",
            status: "SKIPPED",
            durationMs: 0,
          },
        });
        results.push(skipped);
      } catch (error) {
        // Nothing ran (conditions simply didn't match) — only the record of that fact failed to
        // save. Diagnose and continue: an already-committed lead import must not be reported as
        // failed over a bookkeeping write (Finding F1).
        logPersistFailure(
          {
            workspaceId: event.workspaceId,
            trigger: event.trigger,
            automationId: automation.id,
            actionType: "conditions",
            leadId: event.leadId ?? null,
            opportunityId: event.opportunityId ?? null,
          },
          error,
        );
        results.push({
          persisted: false,
          status: "SKIPPED",
          automationId: automation.id,
          actionType: "conditions",
          leadId: event.leadId ?? null,
          opportunityId: event.opportunityId ?? null,
        });
      }
      continue;
    }

    const allActions = asActions(automation.actions);
    const actions = allActions.slice(0, automationLimits.maxActionsPerEvent);
    if (actions.length < allActions.length) {
      logEvent("warn", "automation_actions_truncated", { automationId: automation.id, defined: allActions.length, ran: actions.length });
    }
    for (const [actionIndex, action] of actions.entries()) {
      const dedupeKey = event.eventKey ? `auto:${automation.id}:${actionIndex}:${event.eventKey}` : null;
      const startedAt = new Date();

      // Run the action first; decide success/failure from what actually happened. The
      // bookkeeping write below is attempted afterward and independently, so a failure to
      // persist it can never be reported as the action having succeeded (Finding F1).
      let outcome: { status: "SUCCESS" | "SKIPPED"; result: string } | { status: "FAILED"; error: string };
      try {
        const result = await withTimeout(
          executeAction(event, action, auditBuffer, dedupeKey),
          automationLimits.actionTimeoutMs,
        );
        outcome = { status: result === DUPLICATE_RESULT ? "SKIPPED" : "SUCCESS", result };
      } catch (error) {
        outcome = {
          status: "FAILED",
          error: error instanceof Error ? error.message : "Automation action failed",
        };
      }

      if (outcome.status === "FAILED") {
        logEvent("error", "automation_action_failed", {
          workspaceId: event.workspaceId,
          trigger: event.trigger,
          automationId: automation.id,
          actionType: action.type,
          error: outcome.error,
        });
      }

      if (outcome.status === "FAILED" && event.actorId) {
        try {
          await notify({
            workspaceId: event.workspaceId,
            userId: event.actorId,
            type: "AUTOMATION_FAILED",
            title: `Automation failed: ${automation.name}`,
            body: outcome.error,
            href: "/automations",
            entityType: "Automation",
            entityId: automation.id,
          });
        } catch (notifyError) {
          logPersistFailure(
            {
              workspaceId: event.workspaceId,
              trigger: event.trigger,
              automationId: automation.id,
              actionType: action.type,
              leadId: event.leadId ?? null,
              opportunityId: event.opportunityId ?? null,
              stage: "failure-notify",
            },
            notifyError,
          );
        }
      }

      // One write reflecting the real outcome, instead of an insert(RUNNING) + update(final) —
      // same status/timestamp/failure semantics, half the round trips. `createdAt` is pinned to
      // `startedAt` so it keeps meaning "when this action began", exactly as the old RUNNING
      // insert's createdAt did.
      let execution: Awaited<ReturnType<typeof prisma.automationExecution.create>>;
      try {
        execution = await prisma.automationExecution.create({
          data: {
            workspaceId: event.workspaceId,
            automationId: automation.id,
            trigger: event.trigger,
            leadId: event.leadId ?? null,
            opportunityId: event.opportunityId ?? null,
            action: action.type,
            status: outcome.status,
            result: outcome.status !== "FAILED" ? outcome.result : null,
            error: outcome.status === "FAILED" ? outcome.error : null,
            retryCount: outcome.status === "FAILED" ? 1 : 0,
            durationMs: Date.now() - startedAt.getTime(),
            createdAt: startedAt,
          },
        });
      } catch (error) {
        logPersistFailure(
          {
            workspaceId: event.workspaceId,
            trigger: event.trigger,
            automationId: automation.id,
            actionType: action.type,
            leadId: event.leadId ?? null,
            opportunityId: event.opportunityId ?? null,
            actionOutcome: outcome.status,
          },
          error,
        );
        results.push({
          persisted: false,
          status: outcome.status,
          automationId: automation.id,
          actionType: action.type,
          leadId: event.leadId ?? null,
          opportunityId: event.opportunityId ?? null,
        });
        continue;
      }

      if (outcome.status === "SKIPPED") {
        results.push(execution); // already done for this event: recorded, but not an executed action
        continue;
      }

      await recordAudit(
        auditBuffer,
        outcome.status === "FAILED"
          ? {
              workspaceId: event.workspaceId,
              actorId: event.actorId,
              action: "AUTOMATION_FAILED",
              entity: "AutomationExecution",
              entityId: execution.id,
              metadata: { trigger: event.trigger, action: action.type, error: outcome.error },
            }
          : {
              workspaceId: event.workspaceId,
              actorId: event.actorId,
              action: "AUTOMATION_EXECUTED",
              entity: "AutomationExecution",
              entityId: execution.id,
              metadata: { trigger: event.trigger, action: action.type, result: outcome.result },
            },
      );
      results.push(execution);
    }
  }

  return results;
  });
}

export const DEFAULT_AUTOMATIONS: Array<{
  id: string;
  name: string;
  trigger: AutomationTrigger;
  actions: ActionDef[];
  conditions?: Record<string, unknown>;
}> = [
  {
    id: "auto_lead_created",
    name: "Lead created → create task",
    trigger: "LEAD_CREATED",
    actions: [{ type: "CREATE_TASK", title: "Contact new lead", priority: "HIGH", dueInDays: 1 }],
  },
  {
    id: "auto_lead_qualified",
    name: "Lead qualified → AI analysis",
    trigger: "LEAD_QUALIFIED",
    actions: [
      { type: "RUN_AI_ANALYSIS" },
      { type: "RUN_SCORING" },
      { type: "RUN_PROPERTY_MATCH" },
    ],
  },
  {
    id: "auto_lead_scored_high",
    name: "Lead scored highly → priority action",
    trigger: "LEAD_SCORED_HIGH",
    conditions: { minScore: 80 },
    actions: [
      { type: "NOTIFY", title: "High-value lead", description: "Lead score crossed the priority threshold.", notifyType: "HIGH_VALUE_LEAD" },
    ],
  },
  {
    id: "auto_strong_match",
    name: "Strong property match → outreach",
    trigger: "STRONG_PROPERTY_MATCH",
    conditions: { minMatch: 80 },
    actions: [
      { type: "CREATE_TASK", title: "Send property options", priority: "HIGH", dueInDays: 1 },
    ],
  },
  {
    id: "auto_stage_changed",
    name: "Stage changed → follow-up",
    trigger: "STAGE_CHANGED",
    actions: [{ type: "CREATE_TASK", title: "Follow up after stage change", priority: "HIGH", dueInDays: 2 }],
  },
  {
    id: "auto_proposal_sent",
    name: "Proposal sent → schedule follow-up",
    trigger: "PROPOSAL_SENT",
    actions: [{ type: "CREATE_TASK", title: "Follow up on proposal", priority: "HIGH", dueInDays: 3 }],
  },
  {
    id: "auto_site_visit_done",
    name: "Site visit completed → next-step task",
    trigger: "SITE_VISIT_COMPLETED",
    actions: [{ type: "CREATE_TASK", title: "Log visit notes and next step", priority: "HIGH", dueInDays: 1 }],
  },
  {
    id: "auto_lead_inactive",
    name: "Lead inactive → follow-up task",
    trigger: "LEAD_INACTIVE",
    actions: [{ type: "CREATE_TASK", title: "Re-engage via WhatsApp", priority: "MEDIUM", dueInDays: 1 }],
  },
  {
    id: "auto_proposal_viewed",
    name: "Proposal viewed → notify owner",
    trigger: "PROPOSAL_VIEWED",
    actions: [{ type: "NOTIFY", title: "Proposal viewed", description: "The proposal was marked viewed.", notifyType: "PROPOSAL_VIEWED" }],
  },
];

export async function seedDefaultAutomations(workspaceId: string) {
  for (const def of DEFAULT_AUTOMATIONS) {
    await prisma.automation.upsert({
      where: { id: def.id },
      create: {
        id: def.id,
        workspaceId,
        name: def.name,
        trigger: def.trigger,
        enabled: true,
        paused: false,
        conditions: def.conditions as Prisma.InputJsonValue | undefined,
        actions: def.actions as unknown as Prisma.InputJsonValue,
      },
      update: {
        workspaceId,
        name: def.name,
        trigger: def.trigger,
        enabled: true,
        paused: false,
        conditions: def.conditions as Prisma.InputJsonValue | undefined,
        actions: def.actions as unknown as Prisma.InputJsonValue,
      },
    });
  }
}

/**
 * AUTO-002 scheduled entry point (scripts/run-inactive-lead-automations.ts, daily).
 *  - Eligibility: not LOST/ARCHIVED/CONVERTED, not soft-deleted, no activity for 14 days (rolling 14x24h,
 *    so timezone-independent). Oldest-inactive first, at most 25 leads per workspace per run; a larger
 *    backlog drains over successive runs.
 *  - Idempotency: a lead with a non-FAILED LEAD_INACTIVE execution inside the window is skipped, so a daily
 *    run does not re-action it. A FAILED execution does not block the lead: the next run retries it.
 *  - Duplicate-run prevention: a per-workspace Postgres advisory lock is held for the whole evaluation, so a
 *    cron run overlapping another cron run, a second app instance or the manual POST /api/automations
 *    returns [] for that workspace instead of double-actioning leads (the skip list is read before the
 *    executions are written, so without the lock two concurrent runs would both act).
 * Per-action idempotency keys for retries inside runAutomations itself remain AUTO-003 (Batch 2).
 */
export async function evaluateInactiveLeads(
  workspaceId: string,
  actorId?: string | null,
  options: { deadlineMs?: number; state?: { truncated: boolean } } = {},
) {
  return prisma.$transaction(
    async (tx) => {
      const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtext(${`inactive-leads:${workspaceId}`})) AS locked`;
      if (!locked) return [];
      return evaluateInactiveLeadsLocked(workspaceId, actorId, options);
    },
    // The transaction only holds the lock; the evaluation itself uses the shared client.
    { timeout: 5 * 60_000, maxWait: 5_000 },
  );
}

async function evaluateInactiveLeadsLocked(
  workspaceId: string,
  actorId: string | null | undefined,
  options: { deadlineMs?: number; state?: { truncated: boolean } },
) {
  const deadline = options.deadlineMs ? Date.now() + options.deadlineMs : null;
  const cutoff = new Date(Date.now() - 14 * 86400000);
  const automations = await prisma.automation.findMany({
    where: { workspaceId, trigger: "LEAD_INACTIVE", enabled: true, paused: false },
  });
  if (automations.length === 0) return [];

  const recentlyProcessed = await prisma.automationExecution.findMany({
    where: {
      workspaceId,
      trigger: "LEAD_INACTIVE",
      createdAt: { gte: cutoff },
      leadId: { not: null },
      status: { not: "FAILED" },
    },
    distinct: ["leadId"],
    select: { leadId: true },
  });
  const skipIds = recentlyProcessed.map((r) => r.leadId).filter((id): id is string => id !== null);

  const leads = await prisma.lead.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      stage: { notIn: ["LOST", "ARCHIVED", "CONVERTED"] },
      OR: [{ lastActivityAt: { lt: cutoff } }, { lastActivityAt: null }],
      id: { notIn: skipIds },
    },
    orderBy: [{ lastActivityAt: "asc" }],
    take: 25,
    select: { id: true },
  });
  const results = [];
  const windowKey = Math.floor(Date.now() / (14 * 86400000));
  for (const lead of leads) {
    // Time budget (AUTO-005): stop starting new leads once exceeded; the rest are picked up next run.
    if (deadline && Date.now() > deadline) {
      if (options.state) options.state.truncated = true;
      break;
    }
    results.push(
      ...(await runAutomations(
        {
          workspaceId,
          actorId,
          trigger: "LEAD_INACTIVE",
          leadId: lead.id,
          eventKey: `inactive:${lead.id}:${windowKey}`,
        },
        automations,
      )),
    );
  }
  return results;
}
