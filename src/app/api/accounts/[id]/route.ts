import { ApiError, jsonError, jsonOk, requirePermission } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { assertRelationsInWorkspace } from "@/lib/tenant";
import { emptyToNull } from "@/lib/validations/helpers";
import { parseBody } from "@/lib/validations/common";
import { accountUpdateSchema } from "@/lib/validations/accounts";
import { measuredRoute } from "@/lib/perf";


type RouteContext = { params: Promise<{ id: string }> };

async function findAccount(workspaceId: string, id: string) {
  const account = await prisma.account.findFirst({
    where: { id, workspaceId, deletedAt: null },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      contacts: { where: { deletedAt: null }, take: 50 },
    },
  });
  if (!account) throw new ApiError(404, "Account not found");
  return account;
}

export const GET = measuredRoute("GET /api/accounts/:id", async (_request: Request, context: RouteContext) => {
  try {
    const { workspaceId } = await requirePermission("crm:read");
    const { id } = await context.params;
    return jsonOk(await findAccount(workspaceId, id));
  } catch (error) {
    return jsonError(error);
  }
});

export const PATCH = measuredRoute("PATCH /api/accounts/:id", async (request: Request, context: RouteContext) => {
  try {
    const { workspaceId, userId } = await requirePermission("crm:write");
    await enforceRateLimit({ key: `mut:${workspaceId}:${userId}`, ...RATE_LIMITS.mutation });
    const { id } = await context.params;
    await findAccount(workspaceId, id);
    const body = emptyToNull(parseBody(accountUpdateSchema, await request.json()));
    await assertRelationsInWorkspace(workspaceId, { ownerId: body.ownerId });

    const result = await prisma.account.updateMany({
      where: { id, workspaceId, deletedAt: null },
      data: body,
    });
    if (result.count === 0) throw new ApiError(404, "Account not found");
    const account = await findAccount(workspaceId, id);

    await writeAudit({
      workspaceId,
      actorId: userId,
      action: "ACCOUNT_UPDATED",
      entity: "Account",
      entityId: account.id,
      metadata: { fields: Object.keys(body) },
    });

    return jsonOk(account);
  } catch (error) {
    return jsonError(error);
  }
});

export const DELETE = measuredRoute("DELETE /api/accounts/:id", async (_request: Request, context: RouteContext) => {
  try {
    const { workspaceId, userId } = await requirePermission("crm:delete");
    await enforceRateLimit({ key: `mut:${workspaceId}:${userId}`, ...RATE_LIMITS.mutation });
    const { id } = await context.params;
    await findAccount(workspaceId, id);

    const result = await prisma.account.updateMany({
      where: { id, workspaceId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (result.count === 0) throw new ApiError(404, "Account not found");

    await writeAudit({
      workspaceId,
      actorId: userId,
      action: "ACCOUNT_UPDATED",
      entity: "Account",
      entityId: id,
      metadata: { softDeleted: true },
    });

    return jsonOk({ ok: true, id });
  } catch (error) {
    return jsonError(error);
  }
});
