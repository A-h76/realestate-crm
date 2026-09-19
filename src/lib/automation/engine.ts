import type { Automation, AutomationTrigger, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { analyzeLead } from "@/lib/ai/lead-analysis";
import { explainPropertyMatches } from "@/lib/ai/property-match";
import { notify } from "@/lib/notifications";
import { scoreLead } from "@/lib/scoring/score-lead";
import { measureExecution } from "@/lib/perf";

export type AutomationEvent = {
  workspaceId: string;
  actorId?: string | null;
  trigger: AutomationTrigger;
  leadId?: string | null;
  opportunityId?: string | null;
  payload?: Record<string, unknown>;
};

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

async function executeAction(event: AutomationEvent, action: ActionDef) {
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
      const task = await prisma.task.create({
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
        },
      });
      await writeAudit({
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
      const n = await notify({
        workspaceId: event.workspaceId,
        userId: ownerId,
        type: action.notifyType ?? "HIGH_VALUE_LEAD",
        title: action.title ?? "Attention required",
        body: action.description,
        href: event.leadId ? `/leads/${event.leadId}` : event.opportunityId ? `/opportunities/${event.opportunityId}` : "/dashboard",
        entityType: event.opportunityId ? "Opportunity" : "Lead",
        entityId: event.opportunityId ?? event.leadId ?? undefined,
      });
      return `notification:${n.id}`;
    }
    default:
      return `skipped:unknown:${action.type}`;
  }
}

export async function runAutomations(event: AutomationEvent) {
  return measureExecution(`automation.${event.trigger}`, async () => {
  const automations = await prisma.automation.findMany({
    where: {
      workspaceId: event.workspaceId,
      trigger: event.trigger,
      enabled: true,
      paused: false,
    },
  });

  const results = [];
  for (const automation of automations) {
    if (!conditionsPass(automation, event)) {
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
      continue;
    }

    const actions = asActions(automation.actions);
    for (const action of actions) {
      const started = Date.now();
      const execution = await prisma.automationExecution.create({
        data: {
          workspaceId: event.workspaceId,
          automationId: automation.id,
          trigger: event.trigger,
          leadId: event.leadId ?? null,
          opportunityId: event.opportunityId ?? null,
          action: action.type,
          status: "RUNNING",
        },
      });

      try {
        const result = await executeAction(event, action);
        const updated = await prisma.automationExecution.update({
          where: { id: execution.id },
          data: {
            status: "SUCCESS",
            result,
            durationMs: Date.now() - started,
          },
        });
        await writeAudit({
          workspaceId: event.workspaceId,
          actorId: event.actorId,
          action: "AUTOMATION_EXECUTED",
          entity: "AutomationExecution",
          entityId: updated.id,
          metadata: { trigger: event.trigger, action: action.type, result },
        });
        results.push(updated);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Automation action failed";
        const failed = await prisma.automationExecution.update({
          where: { id: execution.id },
          data: {
            status: "FAILED",
            error: message,
            durationMs: Date.now() - started,
            retryCount: { increment: 1 },
          },
        });
        await writeAudit({
          workspaceId: event.workspaceId,
          actorId: event.actorId,
          action: "AUTOMATION_FAILED",
          entity: "AutomationExecution",
          entityId: failed.id,
          metadata: { trigger: event.trigger, action: action.type, error: message },
        });
        if (event.actorId) {
          await notify({
            workspaceId: event.workspaceId,
            userId: event.actorId,
            type: "AUTOMATION_FAILED",
            title: `Automation failed: ${automation.name}`,
            body: message,
            href: "/automations",
            entityType: "Automation",
            entityId: automation.id,
          });
        }
        results.push(failed);
      }
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
    name: "Lead inactive → WhatsApp re-engagement",
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

export async function evaluateInactiveLeads(workspaceId: string, actorId?: string | null) {
  const cutoff = new Date(Date.now() - 14 * 86400000);
  const leads = await prisma.lead.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      stage: { notIn: ["LOST", "ARCHIVED", "CONVERTED"] },
      OR: [{ lastActivityAt: { lt: cutoff } }, { lastActivityAt: null }],
    },
    take: 25,
    select: { id: true },
  });
  const results = [];
  for (const lead of leads) {
    results.push(
      ...(await runAutomations({
        workspaceId,
        actorId,
        trigger: "LEAD_INACTIVE",
        leadId: lead.id,
      })),
    );
  }
  return results;
}
