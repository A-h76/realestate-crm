import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { OPEN_TASK_STATUSES } from "@/lib/whatsapp/handoff-event";

/**
 * Makes a human handoff actionable: claims the lead (ownerId) and any open
 * handoff task(s) for the given user, and logs a visible Activity note.
 * Reuses the existing Lead/Task/Activity/Audit models — no new "AI mode vs
 * human mode" state, just the same ownership fields the rest of the CRM uses.
 * Returns null when the lead is not in the workspace.
 */
export async function takeOverLead(workspaceId: string, leadId: string, userId: string) {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, workspaceId, deletedAt: null } });
  if (!lead) return null;

  const previousOwnerId = lead.ownerId;

  await prisma.lead.updateMany({
    where: { id: leadId, workspaceId },
    data: { ownerId: userId },
  });

  const claimedTasks = await prisma.task.updateMany({
    where: {
      workspaceId,
      leadId,
      status: { in: [...OPEN_TASK_STATUSES] },
      description: { contains: "[handoff:" },
    },
    data: { status: "IN_PROGRESS", ownerId: userId },
  });

  const activity = await prisma.activity.create({
    data: {
      workspaceId,
      type: "NOTE",
      leadId,
      ownerId: userId,
      status: "COMPLETED",
      title: "Agent took over conversation",
      notes: "Claimed ownership from the WhatsApp inbox.",
      // Read by conversation-orchestrator.ts to permanently suppress automatic replies for this lead (AGENTS spec P0 #5 section 25).
      metadata: { conversationTakeover: true },
    },
  });

  await writeAudit({
    workspaceId,
    actorId: userId,
    action: "LEAD_UPDATED",
    entity: "Lead",
    entityId: leadId,
    metadata: {
      fields: ["ownerId"],
      reason: "handoff_take_over",
      previousOwnerId,
      activityId: activity.id,
    },
  });

  const updated = await prisma.lead.findFirst({
    where: { id: leadId, workspaceId },
    include: { owner: { select: { id: true, name: true, email: true } } },
  });

  return { lead: updated, handoffTasksClaimed: claimedTasks.count };
}
