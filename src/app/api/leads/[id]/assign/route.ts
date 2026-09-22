import { ApiError, jsonError, jsonOk, requirePermission } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { assignLeastLoadedAgent } from "@/lib/assignment/assign-lead";
import { measuredRoute } from "@/lib/perf";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = measuredRoute(
  "POST /api/leads/:id/assign",
  async (_request: Request, context: RouteContext) => {
    try {
      const { workspaceId, userId } = await requirePermission("crm:write");
      await enforceRateLimit({ key: `mut:${workspaceId}:${userId}`, ...RATE_LIMITS.mutation });
      const { id } = await context.params;

      const existing = await prisma.lead.findFirst({ where: { id, workspaceId, deletedAt: null } });
      if (!existing) throw new ApiError(404, "Lead not found");

      const assignment = await assignLeastLoadedAgent(workspaceId);
      if (!assignment) throw new ApiError(400, "No eligible agents in this workspace");

      await prisma.lead.updateMany({
        where: { id, workspaceId, deletedAt: null },
        data: { ownerId: assignment.agentId },
      });
      const lead = await prisma.lead.findFirst({
        where: { id, workspaceId },
        include: { owner: { select: { id: true, name: true, email: true } } },
      });

      await writeAudit({
        workspaceId,
        actorId: userId,
        action: "LEAD_UPDATED",
        entity: "Lead",
        entityId: id,
        metadata: {
          fields: ["ownerId"],
          assignmentStrategy: "least_loaded",
          previousOwnerId: existing.ownerId,
          newOwnerId: assignment.agentId,
        },
      });

      return jsonOk({ lead, assignment });
    } catch (error) {
      return jsonError(error);
    }
  },
);
