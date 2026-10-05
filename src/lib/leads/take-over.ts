import { ApiError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { OPEN_TASK_STATUSES } from "@/lib/whatsapp/handoff-event";
import { lockConversationControl } from "@/lib/messaging/outbound-gate";

/**
 * Makes a human handoff actionable: claims the lead (ownerId) and any open
 * handoff task(s) for the given user, and logs a visible Activity note.
 * Reuses the existing Lead/Task/Activity/Audit models — no new "AI mode vs
 * human mode" state, just the same ownership fields the rest of the CRM uses.
 * Returns null when the lead is not in the workspace.
 *
 * Ownership rule (INTG-007): the same one that governs reassignment everywhere else. Taking over a lead that is
 * unowned or already yours needs only the right to edit; taking over a lead that someone ELSE owns is a reassignment
 * and needs `canReassign` (leads:assign). Concurrent callers queue on the lead row: the first claims it, the second
 * is refused (403) instead of silently overwriting the first. Repeating your own take-over is a no-op (no duplicate
 * note), so a double click or retry is safe. There is deliberately no "release": see the master plan, section 19.
 */
export async function takeOverLead(workspaceId: string, leadId: string, userId: string, opts: { canReassign: boolean }) {
  const outcome = await prisma.$transaction(async (tx) => {
    // Same advisory lock the AI outbound gate takes. Holding it here is what makes take-over
    // atomic with respect to an in-flight automatic reply: either this transaction commits the
    // marker first and the AI send is then refused, or the AI send completes and this take-over
    // suppresses every subsequent one. The two can no longer interleave (US-36).
    await lockConversationControl(tx, workspaceId, leadId);
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Lead" WHERE id = ${leadId} AND "workspaceId" = ${workspaceId} AND "deletedAt" IS NULL FOR NO KEY UPDATE`;
    if (locked.length === 0) return null;

    const lead = await tx.lead.findFirstOrThrow({
      where: { id: leadId, workspaceId },
      select: { ownerId: true, owner: { select: { name: true } } },
    });
    const previousOwnerId = lead.ownerId;

    if (previousOwnerId && previousOwnerId !== userId && !opts.canReassign) {
      throw new ApiError(
        403,
        `This conversation is being handled by ${lead.owner?.name ?? "another team member"}. Ask a manager to reassign it.`,
      );
    }

    if (previousOwnerId === userId) {
      const marker = await tx.activity.findFirst({
        where: { workspaceId, leadId, metadata: { path: ["conversationTakeover"], equals: true } },
        select: { id: true },
      });
      if (marker) return { alreadyHandling: true as const, claimed: 0 };
    }

    await tx.lead.updateMany({ where: { id: leadId, workspaceId }, data: { ownerId: userId, ...(previousOwnerId === userId ? {} : { assignedAt: new Date() }) } });

    const claimedTasks = await tx.task.updateMany({
      where: {
        workspaceId,
        leadId,
        status: { in: [...OPEN_TASK_STATUSES] },
        description: { contains: "[handoff:" },
      },
      data: { status: "IN_PROGRESS", ownerId: userId },
    });

    const activity = await tx.activity.create({
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

    await writeAudit(
      {
        workspaceId,
        actorId: userId,
        action: "LEAD_UPDATED",
        entity: "Lead",
        entityId: leadId,
        fromState: previousOwnerId,
        toState: userId,
        metadata: { fields: ["ownerId"], reason: "handoff_take_over", previousOwnerId, activityId: activity.id },
      },
      tx,
    );
    return { alreadyHandling: false as const, claimed: claimedTasks.count };
  });
  if (!outcome) return null;

  const updated = await prisma.lead.findFirst({
    where: { id: leadId, workspaceId },
    include: { owner: { select: { id: true, name: true, email: true } } },
  });
  return { lead: updated, handoffTasksClaimed: outcome.claimed, alreadyHandling: outcome.alreadyHandling };
}
