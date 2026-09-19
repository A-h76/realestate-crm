import type { Prisma } from "@prisma/client";
import { jsonError, jsonOk, requirePermission } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { assertRelationsInWorkspace } from "@/lib/tenant";
import { emptyToNull, sortOrder } from "@/lib/validations/helpers";
import { paginationSkipTake, parseBody, parseQuery } from "@/lib/validations/common";
import { leadCreateSchema, leadListQuerySchema } from "@/lib/validations/leads";
import { runAutomations } from "@/lib/automation/engine";
import { measuredRoute } from "@/lib/perf";


export const GET = measuredRoute("GET /api/leads", async (request: Request) => {
  try {
    const { workspaceId } = await requirePermission("crm:read");
    const url = new URL(request.url);
    const query = parseQuery(leadListQuerySchema, url.searchParams);
    const { skip, take } = paginationSkipTake(query);

    const where: Prisma.LeadWhereInput = {
      workspaceId,
      deletedAt: null,
      stage: query.stage,
      source: query.source,
      ownerId: query.ownerId,
      intentType: query.intentType,
      ...(query.q
        ? {
            OR: [
              { firstName: { contains: query.q, mode: "insensitive" } },
              { lastName: { contains: query.q, mode: "insensitive" } },
              { company: { contains: query.q, mode: "insensitive" } },
              { email: { contains: query.q, mode: "insensitive" } },
              { phone: { contains: query.q, mode: "insensitive" } },
              { whatsappNumber: { contains: query.q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const sortField = query.sort ?? "createdAt";
    const allowedSort = new Set([
      "createdAt",
      "updatedAt",
      "firstName",
      "stage",
      "source",
      "followUpDue",
      "leadScore",
      "estimatedValue",
      "lastActivityAt",
    ]);
    const orderByKey = allowedSort.has(sortField) ? sortField : "createdAt";

    const [items, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        skip,
        take,
        orderBy: { [orderByKey]: sortOrder(query.order) },
        include: {
          owner: { select: { id: true, name: true, email: true } },
          account: { select: { id: true, company: true } },
          contact: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      prisma.lead.count({ where }),
    ]);

    return jsonOk({
      items,
      total,
      page: query.page,
      pageSize: query.pageSize,
    });
  } catch (error) {
    return jsonError(error);
  }
});

export const POST = measuredRoute("POST /api/leads", async (request: Request) => {
  try {
    const { workspaceId, userId } = await requirePermission("crm:write");
    await enforceRateLimit({ key: `mut:${workspaceId}:${userId}`, ...RATE_LIMITS.mutation });
    const body = emptyToNull(parseBody(leadCreateSchema, await request.json()));
    await assertRelationsInWorkspace(workspaceId, {
      ownerId: body.ownerId,
      accountId: body.accountId,
      contactId: body.contactId,
    });

    const lead = await prisma.lead.create({
      data: {
        workspaceId,
        firstName: body.firstName,
        lastName: body.lastName,
        company: body.company,
        email: body.email || null,
        phone: body.phone,
        whatsappNumber: body.whatsappNumber,
        website: body.website,
        industry: body.industry,
        companySize: body.companySize,
        source: body.source,
        notes: body.notes,
        estimatedValue: body.estimatedValue,
        currency: body.currency,
        ownerId: body.ownerId ?? userId,
        stage: body.stage,
        accountId: body.accountId,
        contactId: body.contactId,
        intentType: body.intentType,
        preferredArea: body.preferredArea,
        budgetMin: body.budgetMin,
        budgetMax: body.budgetMax,
        propertyPurpose: body.propertyPurpose,
        propertyTypePref: body.propertyTypePref,
        sizePrefMin: body.sizePrefMin,
        sizePrefMax: body.sizePrefMax,
        sizeUnitPref: body.sizeUnitPref,
        bedroomPref: body.bedroomPref,
        timeline: body.timeline,
        followUpDue: body.followUpDue,
        nextAction: body.nextAction,
      },
    });

    await writeAudit({
      workspaceId,
      actorId: userId,
      action: "LEAD_CREATED",
      entity: "Lead",
      entityId: lead.id,
      metadata: { stage: lead.stage, source: lead.source },
    });

    await runAutomations({
      workspaceId,
      actorId: userId,
      trigger: "LEAD_CREATED",
      leadId: lead.id,
    });

    return jsonOk(lead, 201);
  } catch (error) {
    return jsonError(error);
  }
});
