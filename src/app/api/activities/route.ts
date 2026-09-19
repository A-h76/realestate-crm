import type { Prisma } from "@prisma/client";
import { jsonError, jsonOk, requirePermission } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { assertRelationsInWorkspace, touchLeadActivity } from "@/lib/tenant";
import { emptyToNull, sortOrder } from "@/lib/validations/helpers";
import { paginationSkipTake, parseBody, parseQuery } from "@/lib/validations/common";
import { activityCreateSchema, activityListQuerySchema } from "@/lib/validations/activities";
import { measuredRoute } from "@/lib/perf";


function asJson(
  value: Record<string, unknown> | null | undefined,
): Prisma.InputJsonValue | undefined {
  if (value == null) return undefined;
  return value as Prisma.InputJsonValue;
}

export const GET = measuredRoute("GET /api/activities", async (request: Request) => {
  try {
    const { workspaceId } = await requirePermission("crm:read");
    const query = parseQuery(activityListQuerySchema, new URL(request.url).searchParams);
    const { skip, take } = paginationSkipTake(query);

    const where: Prisma.ActivityWhereInput = {
      workspaceId,
      type: query.type,
      leadId: query.leadId,
      opportunityId: query.opportunityId,
      accountId: query.accountId,
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: "insensitive" } },
              { notes: { contains: query.q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.activity.findMany({
        where,
        skip,
        take,
        orderBy: { date: sortOrder(query.order === "asc" ? "asc" : "desc") },
        include: {
          owner: { select: { id: true, name: true } },
          lead: { select: { id: true, firstName: true, lastName: true } },
          opportunity: { select: { id: true, name: true } },
        },
      }),
      prisma.activity.count({ where }),
    ]);

    return jsonOk({ items, total, page: query.page, pageSize: query.pageSize });
  } catch (error) {
    return jsonError(error);
  }
});

export const POST = measuredRoute("POST /api/activities", async (request: Request) => {
  try {
    const { workspaceId, userId } = await requirePermission("crm:write");
    await enforceRateLimit({ key: `mut:${workspaceId}:${userId}`, ...RATE_LIMITS.mutation });
    const body = emptyToNull(parseBody(activityCreateSchema, await request.json()));
    await assertRelationsInWorkspace(workspaceId, {
      leadId: body.leadId,
      opportunityId: body.opportunityId,
      accountId: body.accountId,
      contactId: body.contactId,
      ownerId: body.ownerId,
    });

    const activity = await prisma.activity.create({
      data: {
        workspaceId,
        type: body.type,
        leadId: body.leadId,
        opportunityId: body.opportunityId,
        accountId: body.accountId,
        contactId: body.contactId,
        ownerId: body.ownerId ?? userId,
        date: body.date ?? new Date(),
        status: body.status,
        title: body.title,
        notes: body.notes,
        metadata: asJson(body.metadata ?? undefined),
      },
    });

    if (body.leadId) {
      await touchLeadActivity(workspaceId, body.leadId, activity.date);
    }

    await writeAudit({
      workspaceId,
      actorId: userId,
      action: "ACTIVITY_CREATED",
      entity: "Activity",
      entityId: activity.id,
      metadata: { type: activity.type },
    });

    return jsonOk(activity, 201);
  } catch (error) {
    return jsonError(error);
  }
});
