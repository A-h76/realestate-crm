import { z } from "zod";
import { ApiError, jsonError, jsonOk, requirePermission, type WorkspaceAccess } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { ASSIGNABLE_ROLES, memberChangeDenial } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { parseBody } from "@/lib/validations/common";
import { measuredRoute } from "@/lib/perf";

type RouteContext = { params: Promise<{ userId: string }> };

const roleSchema = z.object({ role: z.enum(ASSIGNABLE_ROLES) });

async function loadTarget(access: WorkspaceAccess, targetId: string) {
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: access.workspaceId, userId: targetId } },
  });
  // 404 for members of other workspaces too, so their existence is not confirmed.
  if (!member) throw new ApiError(404, "Member not found");
  return member;
}

export const PATCH = measuredRoute(
  "PATCH /api/workspace/members/:userId",
  async (request: Request, context: RouteContext) => {
    try {
      const access = await requirePermission("members:manage");
      await enforceRateLimit({ key: `mut:${access.workspaceId}:${access.userId}`, ...RATE_LIMITS.mutation });
      const { userId: targetId } = await context.params;
      const { role } = parseBody(roleSchema, await request.json());
      const member = await loadTarget(access, targetId);

      const denial = memberChangeDenial({
        actorId: access.userId,
        actorRole: access.role,
        targetId,
        targetRole: member.role,
        newRole: role,
      });
      if (denial) throw new ApiError(403, denial);

      const updated = await prisma.workspaceMember.update({ where: { id: member.id }, data: { role } });
      await writeAudit({
        workspaceId: access.workspaceId,
        actorId: access.userId,
        action: "MEMBER_ROLE_CHANGED",
        entity: "WorkspaceMember",
        entityId: member.id,
        metadata: { userId: targetId, from: member.role, to: role },
      });
      return jsonOk({ member: { userId: targetId, role: updated.role } });
    } catch (error) {
      return jsonError(error);
    }
  },
);

export const DELETE = measuredRoute(
  "DELETE /api/workspace/members/:userId",
  async (_request: Request, context: RouteContext) => {
    try {
      const access = await requirePermission("members:manage");
      await enforceRateLimit({ key: `mut:${access.workspaceId}:${access.userId}`, ...RATE_LIMITS.mutation });
      const { userId: targetId } = await context.params;
      const member = await loadTarget(access, targetId);

      const denial = memberChangeDenial({
        actorId: access.userId,
        actorRole: access.role,
        targetId,
        targetRole: member.role,
      });
      if (denial) throw new ApiError(403, denial);

      // Records the member owned stay in place (ownerId is kept for history); a manager reassigns them.
      await prisma.workspaceMember.delete({ where: { id: member.id } });
      await writeAudit({
        workspaceId: access.workspaceId,
        actorId: access.userId,
        action: "MEMBER_REMOVED",
        entity: "WorkspaceMember",
        entityId: member.id,
        metadata: { userId: targetId, role: member.role },
      });
      return jsonOk({ removed: true });
    } catch (error) {
      return jsonError(error);
    }
  },
);
