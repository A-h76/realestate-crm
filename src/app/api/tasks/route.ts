import type { Prisma } from "@prisma/client";
import { jsonError, jsonOk, requirePermission } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { assertRelationsInWorkspace } from "@/lib/tenant";
import { emptyToNull, sortOrder } from "@/lib/validations/helpers";
import { paginationSkipTake, parseBody, parseQuery } from "@/lib/validations/common";
import { taskCreateSchema, taskListQuerySchema } from "@/lib/validations/tasks";
import { measuredRoute } from "@/lib/perf";


export const GET = measuredRoute("GET /api/tasks", async (request: Request) => {
  try {
    const { workspaceId } = await requirePermission("crm:read");
    const query = parseQuery(taskListQuerySchema, new URL(request.url).searchParams);
    const { skip, take } = paginationSkipTake(query);

    const where: Prisma.TaskWhereInput = {
      workspaceId,
      deletedAt: null,
      status: query.status,
      priority: query.priority,
      ownerId: query.ownerId,
      leadId: query.leadId,
      opportunityId: query.opportunityId,
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: "insensitive" } },
              { description: { contains: query.q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const sortField = query.sort ?? "dueAt";
    const allowed = new Set(["createdAt", "updatedAt", "dueAt", "priority", "status", "title"]);
    const orderByKey = allowed.has(sortField) ? sortField : "dueAt";

    const [items, total] = await Promise.all([
      prisma.task.findMany({
        where,
        skip,
        take,
        orderBy: { [orderByKey]: sortOrder(query.order) },
        include: {
          owner: { select: { id: true, name: true } },
          lead: { select: { id: true, firstName: true, lastName: true } },
          opportunity: { select: { id: true, name: true } },
        },
      }),
      prisma.task.count({ where }),
    ]);

    return jsonOk({ items, total, page: query.page, pageSize: query.pageSize });
  } catch (error) {
    return jsonError(error);
  }
});

export const POST = measuredRoute("POST /api/tasks", async (request: Request) => {
  try {
    const { workspaceId, userId } = await requirePermission("crm:write");
    await enforceRateLimit({ key: `mut:${workspaceId}:${userId}`, ...RATE_LIMITS.mutation });
    const body = emptyToNull(parseBody(taskCreateSchema, await request.json()));
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

    const task = await prisma.task.create({
      data: {
        workspaceId,
        title: body.title,
        description: body.description,
        status: body.status,
        priority: body.priority,
        dueAt: body.dueAt,
        ownerId: body.ownerId ?? userId,
        leadId: body.leadId,
        opportunityId: body.opportunityId,
        accountId: body.accountId,
        contactId: body.contactId,
        propertyId: body.propertyId,
        proposalId: body.proposalId,
        siteVisitId: body.siteVisitId,
        completedAt: body.status === "DONE" ? new Date() : null,
      },
    });

    await writeAudit({
      workspaceId,
      actorId: userId,
      action: "TASK_CREATED",
      entity: "Task",
      entityId: task.id,
    });

    return jsonOk(task, 201);
  } catch (error) {
    return jsonError(error);
  }
});
