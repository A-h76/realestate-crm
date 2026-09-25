import { z } from "zod";
import { ApiError, jsonError, jsonOk, requirePermission } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { assignLeastLoadedAgent } from "@/lib/assignment/assign-lead";
import { assertMemberInWorkspace } from "@/lib/tenant";
import { parseBody } from "@/lib/validations/common";
import { measuredRoute } from "@/lib/perf";

type RouteContext = { params: Promise<{ id: string }> };

const assignSchema = z.object({ ownerId: z.string().trim().min(1).max(64).optional() });

/**
 * Manager action. With `ownerId` assigns to that workspace member; with an
 * empty body falls back to the least-loaded AGENT (Golden Path behaviour).
 */
export const POST = measuredRoute(
  "POST /api/leads/:id/assign",
  async (request: Request, context: RouteContext) => {
    try {
      const { workspaceId, userId } = await requirePermission("leads:assign");
      await enforceRateLimit({ key: `mut:${workspaceId}:${userId}`, ...RATE_LIMITS.mutation });
      const { id } = await context.params;
      const raw = await request.text();
      const body = parseBody(assignSchema, raw ? JSON.parse(raw) : {});

      const existing = await prisma.lead.findFirst({ where: { id, workspaceId, deletedAt: null } });
      if (!existing) throw new ApiError(404, "Lead not found");

      let assignment: { agentId: string; agentName: string; openLeadCount?: number } | null;
      if (body.ownerId) {
        await assertMemberInWorkspace(workspaceId, body.ownerId);
        const user = await prisma.user.findUniqueOrThrow({ where: { id: body.ownerId }, select: { name: true } });
        assignment = { agentId: body.ownerId, agentName: user.name };
      } else {
        assignment = await assignLeastLoadedAgent(workspaceId);
      }
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
          assignmentStrategy: body.ownerId ? "manual" : "least_loaded",
          previousOwnerId: existing.ownerId,
          newOwnerId: assignment.agentId,
        },
      });

      return jsonOk({ lead, assignment });
    } catch (error) {
      if (error instanceof SyntaxError) return jsonError(new ApiError(400, "Invalid JSON"));
      return jsonError(error);
    }
  },
);
