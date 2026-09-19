import type { Prisma } from "@prisma/client";
import { jsonError, jsonOk, requirePermission } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { assertRelationsInWorkspace } from "@/lib/tenant";
import { emptyToNull, sortOrder } from "@/lib/validations/helpers";
import { paginationSkipTake, parseBody, parseQuery } from "@/lib/validations/common";
import { contactCreateSchema, contactListQuerySchema } from "@/lib/validations/contacts";
import { measuredRoute } from "@/lib/perf";


export const GET = measuredRoute("GET /api/contacts", async (request: Request) => {
  try {
    const { workspaceId } = await requirePermission("crm:read");
    const query = parseQuery(contactListQuerySchema, new URL(request.url).searchParams);
    const { skip, take } = paginationSkipTake(query);

    const where: Prisma.ContactWhereInput = {
      workspaceId,
      deletedAt: null,
      accountId: query.accountId,
      ...(query.q
        ? {
            OR: [
              { firstName: { contains: query.q, mode: "insensitive" } },
              { lastName: { contains: query.q, mode: "insensitive" } },
              { email: { contains: query.q, mode: "insensitive" } },
              { phone: { contains: query.q, mode: "insensitive" } },
              { whatsappNumber: { contains: query.q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const sortField = query.sort ?? "createdAt";
    const allowed = new Set(["createdAt", "updatedAt", "firstName", "lastName"]);
    const orderByKey = allowed.has(sortField) ? sortField : "createdAt";

    const [items, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        skip,
        take,
        orderBy: { [orderByKey]: sortOrder(query.order) },
        include: {
          account: { select: { id: true, company: true } },
        },
      }),
      prisma.contact.count({ where }),
    ]);

    return jsonOk({ items, total, page: query.page, pageSize: query.pageSize });
  } catch (error) {
    return jsonError(error);
  }
});

export const POST = measuredRoute("POST /api/contacts", async (request: Request) => {
  try {
    const { workspaceId, userId } = await requirePermission("crm:write");
    await enforceRateLimit({ key: `mut:${workspaceId}:${userId}`, ...RATE_LIMITS.mutation });
    const body = emptyToNull(parseBody(contactCreateSchema, await request.json()));
    await assertRelationsInWorkspace(workspaceId, { accountId: body.accountId });

    const contact = await prisma.contact.create({
      data: {
        workspaceId,
        firstName: body.firstName,
        lastName: body.lastName,
        title: body.title,
        email: body.email || null,
        phone: body.phone,
        whatsappNumber: body.whatsappNumber,
        accountId: body.accountId,
        notes: body.notes,
      },
    });

    await writeAudit({
      workspaceId,
      actorId: userId,
      action: "CONTACT_CREATED",
      entity: "Contact",
      entityId: contact.id,
    });

    return jsonOk(contact, 201);
  } catch (error) {
    return jsonError(error);
  }
});
