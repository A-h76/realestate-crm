import type { Prisma } from "@prisma/client";
import { jsonError, jsonOk, requirePermission } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { assertRelationsInWorkspace } from "@/lib/tenant";
import { emptyToNull, sortOrder } from "@/lib/validations/helpers";
import { paginationSkipTake, parseBody, parseQuery } from "@/lib/validations/common";
import { proposalCreateSchema, proposalListQuerySchema } from "@/lib/validations/proposals";
import { measuredRoute } from "@/lib/perf";


export const GET = measuredRoute("GET /api/proposals", async (request: Request) => {
  try {
    const { workspaceId } = await requirePermission("crm:read");
    const query = parseQuery(proposalListQuerySchema, new URL(request.url).searchParams);
    const { skip, take } = paginationSkipTake(query);

    const where: Prisma.ProposalWhereInput = {
      workspaceId,
      deletedAt: null,
      status: query.status,
      leadId: query.leadId,
      opportunityId: query.opportunityId,
      ...(query.q
        ? {
            OR: [
              { proposalNumber: { contains: query.q, mode: "insensitive" } },
              { notes: { contains: query.q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const sortField = query.sort ?? "createdAt";
    const allowed = new Set(["createdAt", "updatedAt", "proposalNumber", "value", "status", "sentAt"]);
    const orderByKey = allowed.has(sortField) ? sortField : "createdAt";

    const [items, total] = await Promise.all([
      prisma.proposal.findMany({
        where,
        skip,
        take,
        orderBy: { [orderByKey]: sortOrder(query.order) },
        include: {
          owner: { select: { id: true, name: true } },
          lead: { select: { id: true, firstName: true, lastName: true } },
          opportunity: { select: { id: true, name: true } },
          linkedProperty: { select: { id: true, title: true } },
        },
      }),
      prisma.proposal.count({ where }),
    ]);

    return jsonOk({ items, total, page: query.page, pageSize: query.pageSize });
  } catch (error) {
    return jsonError(error);
  }
});

export const POST = measuredRoute("POST /api/proposals", async (request: Request) => {
  try {
    const { workspaceId, userId } = await requirePermission("crm:write");
    await enforceRateLimit({ key: `mut:${workspaceId}:${userId}`, ...RATE_LIMITS.mutation });
    const body = emptyToNull(parseBody(proposalCreateSchema, await request.json()));
    await assertRelationsInWorkspace(workspaceId, {
      leadId: body.leadId,
      opportunityId: body.opportunityId,
      linkedPropertyId: body.linkedPropertyId,
      ownerId: body.ownerId,
    });

    const proposalNumber =
      body.proposalNumber ??
      `PROP-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;

    const proposal = await prisma.proposal.create({
      data: {
        workspaceId,
        proposalNumber,
        leadId: body.leadId,
        opportunityId: body.opportunityId,
        linkedPropertyId: body.linkedPropertyId,
        value: body.value,
        currency: body.currency,
        status: body.status,
        expiryAt: body.expiryAt,
        attachmentUrl: body.attachmentUrl,
        notes: body.notes,
        ownerId: body.ownerId ?? userId,
      },
    });

    await writeAudit({
      workspaceId,
      actorId: userId,
      action: "PROPOSAL_CREATED",
      entity: "Proposal",
      entityId: proposal.id,
    });

    return jsonOk(proposal, 201);
  } catch (error) {
    return jsonError(error);
  }
});
