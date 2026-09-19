import { jsonError, jsonOk, requirePermission } from "@/lib/api";
import { prisma } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { measuredRoute } from "@/lib/perf";


export const GET = measuredRoute("GET /api/search", async (request: Request) => {
  try {
    const { workspaceId, userId } = await requirePermission("search:use");
    await enforceRateLimit({ key: `search:${workspaceId}:${userId}`, ...RATE_LIMITS.search });
    const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
    if (q.length < 1) return jsonOk({ leads: [], accounts: [], contacts: [], properties: [], opportunities: [], tasks: [], proposals: [], activities: [] });

    const contains = { contains: q, mode: "insensitive" as const };

    const [leads, accounts, contacts, properties, opportunities, tasks, proposals, activities] =
      await Promise.all([
        prisma.lead.findMany({
          where: {
            workspaceId,
            deletedAt: null,
            OR: [{ firstName: contains }, { lastName: contains }, { company: contains }, { email: contains }, { phone: contains }],
          },
          take: 6,
          select: { id: true, firstName: true, lastName: true, company: true, stage: true },
        }),
        prisma.account.findMany({
          where: { workspaceId, deletedAt: null, company: contains },
          take: 5,
          select: { id: true, company: true },
        }),
        prisma.contact.findMany({
          where: {
            workspaceId,
            deletedAt: null,
            OR: [{ firstName: contains }, { lastName: contains }, { email: contains }],
          },
          take: 5,
          select: { id: true, firstName: true, lastName: true },
        }),
        prisma.property.findMany({
          where: {
            workspaceId,
            deletedAt: null,
            OR: [{ title: contains }, { area: contains }, { address: contains }],
          },
          take: 6,
          select: { id: true, title: true, area: true, price: true },
        }),
        prisma.opportunity.findMany({
          where: { workspaceId, deletedAt: null, name: contains },
          take: 6,
          select: { id: true, name: true, value: true },
        }),
        prisma.task.findMany({
          where: { workspaceId, deletedAt: null, title: contains },
          take: 5,
          select: { id: true, title: true, status: true },
        }),
        prisma.proposal.findMany({
          where: {
            workspaceId,
            deletedAt: null,
            OR: [{ proposalNumber: contains }, { notes: contains }],
          },
          take: 5,
          select: { id: true, proposalNumber: true, status: true },
        }),
        prisma.activity.findMany({
          where: {
            workspaceId,
            OR: [{ title: contains }, { notes: contains }],
          },
          take: 5,
          select: { id: true, title: true, type: true, leadId: true },
        }),
      ]);

    return jsonOk({ leads, accounts, contacts, properties, opportunities, tasks, proposals, activities });
  } catch (error) {
    return jsonError(error);
  }
});
