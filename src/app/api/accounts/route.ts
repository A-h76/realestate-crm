import type { Prisma } from "@prisma/client";
import { jsonError, jsonOk, requirePermission } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { assertRelationsInWorkspace } from "@/lib/tenant";
import { emptyToNull, sortOrder } from "@/lib/validations/helpers";
import { paginationSkipTake, parseBody, parseQuery } from "@/lib/validations/common";
import { accountCreateSchema, accountListQuerySchema } from "@/lib/validations/accounts";
import { measuredRoute } from "@/lib/perf";


export const GET = measuredRoute("GET /api/accounts", async (request: Request) => {
  try {
    const { workspaceId } = await requirePermission("crm:read");
    const query = parseQuery(accountListQuerySchema, new URL(request.url).searchParams);
    const { skip, take } = paginationSkipTake(query);

    const where: Prisma.AccountWhereInput = {
      workspaceId,
      deletedAt: null,
      ownerId: query.ownerId,
      city: query.city,
      ...(query.q
        ? {
            OR: [
              { company: { contains: query.q, mode: "insensitive" } },
              { industry: { contains: query.q, mode: "insensitive" } },
              { city: { contains: query.q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const sortField = query.sort ?? "createdAt";
    const allowed = new Set(["createdAt", "updatedAt", "company", "city"]);
    const orderByKey = allowed.has(sortField) ? sortField : "createdAt";

    const [items, total] = await Promise.all([
      prisma.account.findMany({
        where,
        skip,
        take,
        orderBy: { [orderByKey]: sortOrder(query.order) },
        include: {
          owner: { select: { id: true, name: true, email: true } },
          _count: { select: { contacts: true, leads: true } },
        },
      }),
      prisma.account.count({ where }),
    ]);

    return jsonOk({ items, total, page: query.page, pageSize: query.pageSize });
  } catch (error) {
    return jsonError(error);
  }
});

export const POST = measuredRoute("POST /api/accounts", async (request: Request) => {
  try {
    const { workspaceId, userId } = await requirePermission("crm:write");
    await enforceRateLimit({ key: `mut:${workspaceId}:${userId}`, ...RATE_LIMITS.mutation });
    const body = emptyToNull(parseBody(accountCreateSchema, await request.json()));
    await assertRelationsInWorkspace(workspaceId, { ownerId: body.ownerId });

    const account = await prisma.account.create({
      data: {
        workspaceId,
        company: body.company,
        website: body.website,
        industry: body.industry,
        companySize: body.companySize,
        locationArea: body.locationArea,
        city: body.city,
        revenueRange: body.revenueRange,
        ownerId: body.ownerId ?? userId,
        notes: body.notes,
      },
    });

    await writeAudit({
      workspaceId,
      actorId: userId,
      action: "ACCOUNT_CREATED",
      entity: "Account",
      entityId: account.id,
    });

    return jsonOk(account, 201);
  } catch (error) {
    return jsonError(error);
  }
});
