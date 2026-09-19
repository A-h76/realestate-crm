import type { Prisma } from "@prisma/client";
import { jsonError, jsonOk, requirePermission } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { assertRelationsInWorkspace } from "@/lib/tenant";
import { emptyToNull, sortOrder } from "@/lib/validations/helpers";
import { paginationSkipTake, parseBody, parseQuery } from "@/lib/validations/common";
import { propertyCreateSchema, propertyListQuerySchema } from "@/lib/validations/properties";
import { measuredRoute } from "@/lib/perf";


export const GET = measuredRoute("GET /api/properties", async (request: Request) => {
  try {
    const { workspaceId } = await requirePermission("crm:read");
    const query = parseQuery(propertyListQuerySchema, new URL(request.url).searchParams);
    const { skip, take } = paginationSkipTake(query);

    const where: Prisma.PropertyWhereInput = {
      workspaceId,
      deletedAt: null,
      status: query.status,
      propertyType: query.propertyType,
      purpose: query.purpose,
      area: query.area,
      city: query.city,
      assignedAgentId: query.assignedAgentId,
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: "insensitive" } },
              { address: { contains: query.q, mode: "insensitive" } },
              { area: { contains: query.q, mode: "insensitive" } },
              { city: { contains: query.q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const sortField = query.sort ?? "createdAt";
    const allowed = new Set(["createdAt", "updatedAt", "title", "price", "status", "dateListed"]);
    const orderByKey = allowed.has(sortField) ? sortField : "createdAt";

    const [items, total] = await Promise.all([
      prisma.property.findMany({
        where,
        skip,
        take,
        orderBy: { [orderByKey]: sortOrder(query.order) },
        include: {
          assignedAgent: { select: { id: true, name: true } },
          ownerContact: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      prisma.property.count({ where }),
    ]);

    return jsonOk({ items, total, page: query.page, pageSize: query.pageSize });
  } catch (error) {
    return jsonError(error);
  }
});

export const POST = measuredRoute("POST /api/properties", async (request: Request) => {
  try {
    const { workspaceId, userId } = await requirePermission("crm:write");
    await enforceRateLimit({ key: `mut:${workspaceId}:${userId}`, ...RATE_LIMITS.mutation });
    const body = emptyToNull(parseBody(propertyCreateSchema, await request.json()));
    await assertRelationsInWorkspace(workspaceId, {
      ownerContactId: body.ownerContactId,
      assignedAgentId: body.assignedAgentId,
    });

    const property = await prisma.property.create({
      data: {
        workspaceId,
        title: body.title,
        description: body.description,
        address: body.address,
        area: body.area,
        city: body.city,
        propertyType: body.propertyType,
        purpose: body.purpose,
        size: body.size,
        sizeUnit: body.sizeUnit,
        bedrooms: body.bedrooms,
        bathrooms: body.bathrooms,
        furnishedStatus: body.furnishedStatus,
        price: body.price,
        currency: body.currency,
        status: body.status,
        listingType: body.listingType,
        ownerContactId: body.ownerContactId,
        assignedAgentId: body.assignedAgentId ?? userId,
        listingSource: body.listingSource,
        verificationStatus: body.verificationStatus,
        dateListed: body.dateListed ?? undefined,
      },
    });

    await writeAudit({
      workspaceId,
      actorId: userId,
      action: "PROPERTY_CREATED",
      entity: "Property",
      entityId: property.id,
    });

    return jsonOk(property, 201);
  } catch (error) {
    return jsonError(error);
  }
});
