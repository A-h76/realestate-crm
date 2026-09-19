import { ApiError, jsonError, jsonOk, requirePermission } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { assertRelationsInWorkspace } from "@/lib/tenant";
import { emptyToNull } from "@/lib/validations/helpers";
import { parseBody } from "@/lib/validations/common";
import { taskUpdateSchema } from "@/lib/validations/tasks";
import { measuredRoute } from "@/lib/perf";


type RouteContext = { params: Promise<{ id: string }> };

async function findTask(workspaceId: string, id: string) {
  const task = await prisma.task.findFirst({
    where: { id, workspaceId, deletedAt: null },
    include: {
      owner: { select: { id: true, name: true } },
      lead: { select: { id: true, firstName: true, lastName: true } },
      opportunity: { select: { id: true, name: true } },
    },
  });
  if (!task) throw new ApiError(404, "Task not found");
  return task;
}

export const GET = measuredRoute("GET /api/tasks/:id", async (_request: Request, context: RouteContext) => {
  try {
    const { workspaceId } = await requirePermission("crm:read");
    const { id } = await context.params;
    return jsonOk(await findTask(workspaceId, id));
  } catch (error) {
    return jsonError(error);
  }
});

export const PATCH = measuredRoute("PATCH /api/tasks/:id", async (request: Request, context: RouteContext) => {
  try {
    const { workspaceId, userId } = await requirePermission("crm:write");
    await enforceRateLimit({ key: `mut:${workspaceId}:${userId}`, ...RATE_LIMITS.mutation });
    const { id } = await context.params;
    const existing = await findTask(workspaceId, id);
    const body = emptyToNull(parseBody(taskUpdateSchema, await request.json()));
    await assertRelationsInWorkspace(workspaceId, {
      ownerId: body.ownerId,
      leadId: body.leadId,
      opportunityId: body.opportunityId,
      accountId: body.accountId,
      contactId: body.contactId,
      propertyId: body.propertyId,
      proposalId: body.proposalId,
      siteVisitId: body.siteVisitId,
    });

    const markingDone = body.status === "DONE" && existing.status !== "DONE";

    const updated = await prisma.task.updateMany({
      where: { id, workspaceId, deletedAt: null },
      data: {
        ...body,
        completedAt: markingDone
          ? new Date()
          : body.status && body.status !== "DONE"
            ? null
            : undefined,
      },
    });
    if (updated.count === 0) throw new ApiError(404, "Task not found");
    const task = await findTask(workspaceId, id);

    if (markingDone) {
      await writeAudit({
        workspaceId,
        actorId: userId,
        action: "TASK_COMPLETED",
        entity: "Task",
        entityId: task.id,
      });
    } else {
      await writeAudit({
        workspaceId,
        actorId: userId,
        action: "TASK_UPDATED",
        entity: "Task",
        entityId: task.id,
        metadata: { fields: Object.keys(body) },
      });
    }

    return jsonOk(task);
  } catch (error) {
    return jsonError(error);
  }
});

export const DELETE = measuredRoute("DELETE /api/tasks/:id", async (_request: Request, context: RouteContext) => {
  try {
    const { workspaceId, userId } = await requirePermission("crm:delete");
    await enforceRateLimit({ key: `mut:${workspaceId}:${userId}`, ...RATE_LIMITS.mutation });
    const { id } = await context.params;
    await findTask(workspaceId, id);

    const result = await prisma.task.updateMany({
      where: { id, workspaceId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (result.count === 0) throw new ApiError(404, "Task not found");
    const task = { id };

    await writeAudit({
      workspaceId,
      actorId: userId,
      action: "TASK_UPDATED",
      entity: "Task",
      entityId: task.id,
      metadata: { softDeleted: true },
    });

    return jsonOk({ ok: true, id: task.id });
  } catch (error) {
    return jsonError(error);
  }
});
