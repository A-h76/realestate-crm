import type { Lead, TaskPriority } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { assignLeastLoadedAgent } from "@/lib/assignment/assign-lead";
import { filterAndScoreProperties } from "@/lib/matching/properties";
import { formatCurrency } from "@/lib/format";
import {
  HANDOFF_REASON_LABELS,
  SUGGESTED_ACTION_LABELS,
  type HandoffConfidence,
  type HandoffDetection,
  type HandoffReason,
} from "./detect-handoff";

export const OPEN_TASK_STATUSES = ["TODO", "IN_PROGRESS"] as const;

const CONFIDENCE_TO_PRIORITY: Record<HandoffConfidence, TaskPriority> = {
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
};

/** Marker embedded in the Task description used to dedupe repeat handoffs for the same lead + reason. */
export function handoffTaskTag(reason: HandoffReason): string {
  return `[handoff:${reason}]`;
}

/** Pure predicate behind the idempotency check — kept separate from the DB query so it's unit-testable. */
export function isHandoffAlreadyOpen(openTaskDescriptions: Array<string | null>, reason: HandoffReason): boolean {
  const tag = handoffTaskTag(reason);
  return openTaskDescriptions.some((description) => description?.includes(tag));
}

function requirementSummary(lead: Lead): string {
  const parts: string[] = [];
  if (lead.sizePrefMin || lead.sizePrefMax) {
    const size = lead.sizePrefMin && lead.sizePrefMax && lead.sizePrefMin !== lead.sizePrefMax
      ? `${lead.sizePrefMin}-${lead.sizePrefMax}`
      : `${lead.sizePrefMin ?? lead.sizePrefMax}`;
    parts.push(`${size} ${lead.sizeUnitPref ?? ""}`.trim());
  }
  if (lead.propertyTypePref) parts.push(lead.propertyTypePref);
  if (lead.preferredArea) parts.push(lead.preferredArea);
  if (lead.propertyPurpose) parts.push(lead.propertyPurpose === "RENT" ? "Rent" : "Sale");
  if (lead.budgetMin || lead.budgetMax) {
    const min = lead.budgetMin ? Number(lead.budgetMin) : null;
    const max = lead.budgetMax ? Number(lead.budgetMax) : null;
    parts.push(
      min != null && max != null && min !== max
        ? `${formatCurrency(min, lead.currency)} - ${formatCurrency(max, lead.currency)}`
        : `Up to ${formatCurrency(max ?? min, lead.currency)}`,
    );
  }
  return parts.length ? parts.join(", ") : "Unknown";
}

export type HandoffDetectionTrue = Extract<HandoffDetection, { shouldHandoff: true }>;

/**
 * Turns a positive handoff detection into the CRM-visible event: an Activity
 * (grounded summary, for the lead timeline), a Task (agent follow-through),
 * an audit entry, and a notification to the assigned agent — reusing the
 * existing models rather than a new "handoff" table. Idempotent per
 * lead+reason via an open Task carrying the same tag.
 */
export async function triggerHandoff(input: {
  workspaceId: string;
  leadId: string;
  detection: HandoffDetectionTrue;
  triggerMessage: string;
  triggerMessageId: string;
}): Promise<void> {
  const { workspaceId, leadId, detection } = input;

  const openTasks = await prisma.task.findMany({
    where: { workspaceId, leadId, status: { in: [...OPEN_TASK_STATUSES] } },
    select: { description: true },
  });
  if (isHandoffAlreadyOpen(openTasks.map((t) => t.description), detection.reason)) return;

  const lead = await prisma.lead.findFirst({ where: { id: leadId, workspaceId, deletedAt: null } });
  if (!lead) return;

  let ownerId = lead.ownerId;
  if (!ownerId) {
    const assignment = await assignLeastLoadedAgent(workspaceId);
    if (assignment) {
      ownerId = assignment.agentId;
      await prisma.lead.updateMany({ where: { id: lead.id, workspaceId }, data: { ownerId } });
      await writeAudit({
        workspaceId,
        action: "LEAD_UPDATED",
        entity: "Lead",
        entityId: lead.id,
        metadata: { fields: ["ownerId"], assignmentStrategy: "least_loaded", reason: "handoff_auto_assign" },
      });
    }
  }

  const properties = await prisma.property.findMany({ where: { workspaceId, deletedAt: null }, take: 80 });
  const matchedCount = filterAndScoreProperties(lead, properties).length;

  const name = `${lead.firstName} ${lead.lastName ?? ""}`.trim() || "Unknown";
  const phone = lead.whatsappNumber ?? lead.phone ?? "Unknown";
  const reasonLabel = HANDOFF_REASON_LABELS[detection.reason];
  const actionLabel = SUGGESTED_ACTION_LABELS[detection.suggestedAction];

  const summary = [
    "HUMAN HANDOFF REQUIRED",
    "",
    `Reason: ${reasonLabel}`,
    `Lead: ${name} (${phone})`,
    `Requirement: ${requirementSummary(lead)}`,
    `Matched Properties: ${matchedCount}`,
    `Last Customer Message: "${input.triggerMessage}"`,
    `Suggested Action: ${actionLabel}`,
    `Priority: ${detection.confidence}`,
  ].join("\n");

  const activity = await prisma.activity.create({
    data: {
      workspaceId,
      type: "SYSTEM",
      leadId: lead.id,
      ownerId,
      status: "COMPLETED",
      title: `Human handoff — ${reasonLabel}`,
      notes: summary,
      metadata: {
        handoff: true,
        reason: detection.reason,
        confidence: detection.confidence,
        suggestedAction: detection.suggestedAction,
        triggerMessageId: input.triggerMessageId,
        matchedPropertyCount: matchedCount,
      },
    },
  });

  await prisma.task.create({
    data: {
      workspaceId,
      leadId: lead.id,
      ownerId,
      title: `Human handoff — ${reasonLabel}`,
      description: `${summary}\n\n${handoffTaskTag(detection.reason)}`,
      priority: CONFIDENCE_TO_PRIORITY[detection.confidence],
      dueAt: new Date(),
    },
  });

  await writeAudit({
    workspaceId,
    action: "HANDOFF_TRIGGERED",
    entity: "Lead",
    entityId: lead.id,
    metadata: {
      reason: detection.reason,
      triggerMessageId: input.triggerMessageId,
      suggestedAction: detection.suggestedAction,
      confidence: detection.confidence,
      activityId: activity.id,
    },
  });

  if (ownerId) {
    await notify({
      workspaceId,
      userId: ownerId,
      type: "HUMAN_HANDOFF_REQUIRED",
      title: "Human handoff required",
      body: `${reasonLabel} for ${name}'s lead.`,
      href: `/leads/${lead.id}`,
      entityType: "Lead",
      entityId: lead.id,
    });
  }
}
