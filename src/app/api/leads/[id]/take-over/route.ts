import { ApiError, jsonError, jsonOk, requirePermission } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { OPEN_TASK_STATUSES } from "@/lib/whatsapp/handoff-event";
import { measuredRoute } from "@/lib/perf";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Makes a human handoff actionable: claims the lead (ownerId) and any open
 * handoff task(s) for the current agent, and logs a visible Activity note.
 * Reuses the existing Lead/Task/Activity/Audit models — no new "AI mode vs
 * human mode" state, just the same ownership fields the rest of the CRM uses.
 */
export const POST = measuredRoute(
  "POST /api/leads/:id/take-over",
  async (_request: Request, context: RouteContext) => {
    try {
      const { workspaceId, userId } = await requirePermission("crm:write");
      await enforceRateLimit({ key: `mut:${workspaceId}:${userId}`, ...RATE_LIMITS.mutation });
      const { id } = await context.params;

      const lead = await prisma.lead.findFirst({ where: { id, workspaceId, deletedAt: null } });
      if (!lead) throw new ApiError(404, "Lead not found");

      const previousOwnerId = lead.ownerId;

      await prisma.lead.updateMany({
        where: { id, workspaceId },
        data: { ownerId: userId },
      });

      const claimedTasks = await prisma.task.updateMany({
        where: {
          workspaceId,
          leadId: id,
          status: { in: [...OPEN_TASK_STATUSES] },
          description: { contains: "[handoff:" },
        },
        data: { status: "IN_PROGRESS", ownerId: userId },
      });

      const activity = await prisma.activity.create({
        data: {
          workspaceId,
          type: "NOTE",
          leadId: id,
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
        entityId: id,
        metadata: {
          fields: ["ownerId"],
          reason: "handoff_take_over",
          previousOwnerId,
          activityId: activity.id,
        },
      });

      const updated = await prisma.lead.findFirst({
        where: { id, workspaceId },
        include: { owner: { select: { id: true, name: true, email: true } } },
      });

      return jsonOk({ lead: updated, handoffTasksClaimed: claimedTasks.count });
    } catch (error) {
      return jsonError(error);
    }
  },
);
