import type { Prisma } from "@prisma/client";
import { ApiError, jsonError, jsonOk, requirePermission } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { assertRelationsInWorkspace } from "@/lib/tenant";
import { emptyToNull, sortOrder } from "@/lib/validations/helpers";
import { paginationSkipTake, parseBody, parseQuery } from "@/lib/validations/common";
import {
  opportunityCreateSchema,
  opportunityListQuerySchema,
} from "@/lib/validations/opportunities";
import { measuredRoute } from "@/lib/perf";

export const GET = measuredRoute("GET /api/opportunities", async (request: Request) => {
  try {
    const { workspaceId } = await requirePermission("crm:read");
    const query = parseQuery(opportunityListQuerySchema, new URL(request.url).searchParams);
    const { skip, take } = paginationSkipTake(query);

    const where: Prisma.OpportunityWhereInput = {
      workspaceId,
      deletedAt: null,
      stageId: query.stageId,
      dealSide: query.dealSide,
      ownerId: query.ownerId,
      leadId: query.leadId,
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: "insensitive" } },
              { description: { contains: query.q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const sortField = query.sort ?? "createdAt";
    const allowed = new Set([
      "createdAt",
      "updatedAt",
      "name",
      "value",
      "probability",
      "expectedCloseDate",
      "stageEnteredAt",
    ]);
    const orderByKey = allowed.has(sortField) ? sortField : "createdAt";

    const [items, total] = await Promise.all([
      prisma.opportunity.findMany({
        where,
        skip,
        take,
        orderBy: { [orderByKey]: sortOrder(query.order) },
        include: {
          stage: true,
          owner: { select: { id: true, name: true } },
          lead: { select: { id: true, firstName: true, lastName: true, leadScore: true, nextAction: true } },
          linkedProperty: { select: { id: true, title: true } },
          primaryContact: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      prisma.opportunity.count({ where }),
    ]);

    return jsonOk({ items, total, page: query.page, pageSize: query.pageSize });
  } catch (error) {
    return jsonError(error);
  }
});

export const POST = measuredRoute("POST /api/opportunities", async (request: Request) => {
  try {
    const { workspaceId, userId } = await requirePermission("crm:write");
    await enforceRateLimit({ key: `mut:${workspaceId}:${userId}`, ...RATE_LIMITS.mutation });
    const body = emptyToNull(parseBody(opportunityCreateSchema, await request.json()));
    await assertRelationsInWorkspace(workspaceId, {
      accountId: body.accountId,
      primaryContactId: body.primaryContactId,
      leadId: body.leadId,
      linkedPropertyId: body.linkedPropertyId,
      stageId: body.stageId,
      ownerId: body.ownerId,
    });

    const stage = await prisma.pipelineStage.findFirst({
      where: { id: body.stageId, workspaceId, active: true },
    });
    if (!stage) throw new ApiError(400, "Invalid pipeline stage");

    const opportunity = await prisma.opportunity.create({
      data: {
        workspaceId,
        name: body.name,
        accountId: body.accountId,
        primaryContactId: body.primaryContactId,
        leadId: body.leadId,
        linkedPropertyId: body.linkedPropertyId,
        dealSide: body.dealSide,
        value: body.value,
        currency: body.currency,
        probability: body.probability ?? stage.probability,
        stageId: body.stageId,
        ownerId: body.ownerId ?? userId,
        expectedCloseDate: body.expectedCloseDate,
        source: body.source,
        description: body.description,
        notes: body.notes,
        stageEnteredAt: new Date(),
      },
      include: { stage: true },
    });

    await writeAudit({
      workspaceId,
      actorId: userId,
      action: "OPPORTUNITY_CREATED",
      entity: "Opportunity",
      entityId: opportunity.id,
      metadata: { stageId: opportunity.stageId, value: Number(opportunity.value) },
    });

    return jsonOk(opportunity, 201);
  } catch (error) {
    return jsonError(error);
  }
});
