import { jsonError, jsonOk, requirePermission } from "@/lib/api";
import { prisma } from "@/lib/db";
import { isDemoMode } from "@/lib/demo-mode";
import { measuredRoute } from "@/lib/perf";


function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function toNumber(value: { toString(): string } | number | null | undefined): number {
  if (value == null) return 0;
  return typeof value === "number" ? value : Number(value.toString());
}

export const GET = measuredRoute("GET /api/dashboard", async (_request: Request) => {
  try {
    const { workspaceId } = await requirePermission("crm:read");
    const todayStart = startOfToday();
    const todayEnd = endOfToday();
    const weekAgo = daysAgo(7);

    const [
      newLeads,
      qualified,
      openOpportunities,
      openOpps,
      wonStages,
      followUpsDue,
      overdueTasks,
      upcomingSiteVisits,
      recentActivity,
      recentOpportunities,
      priorityTasks,
      overdueLeads,
    ] = await Promise.all([
      prisma.lead.count({
        where: {
          workspaceId,
          deletedAt: null,
          createdAt: { gte: weekAgo },
          stage: { in: ["NEW", "CONTACTED"] },
        },
      }),
      prisma.lead.count({
        where: { workspaceId, deletedAt: null, stage: "QUALIFIED" },
      }),
      prisma.opportunity.count({
        where: {
          workspaceId,
          deletedAt: null,
          stage: { isWon: false, isLost: false },
        },
      }),
      prisma.opportunity.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          stage: { isWon: false, isLost: false },
        },
        select: { value: true, probability: true },
      }),
      prisma.opportunity.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          stage: { isWon: true },
        },
        select: { value: true },
      }),
      prisma.task.count({
        where: {
          workspaceId,
          deletedAt: null,
          status: { in: ["TODO", "IN_PROGRESS"] },
          dueAt: { gte: todayStart, lte: todayEnd },
        },
      }),
      prisma.task.count({
        where: {
          workspaceId,
          deletedAt: null,
          status: { in: ["TODO", "IN_PROGRESS"] },
          dueAt: { lt: todayStart },
        },
      }),
      prisma.calendarEvent.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          type: "SITE_VISIT",
          status: "SCHEDULED",
          startAt: { gte: todayStart },
        },
        orderBy: { startAt: "asc" },
        take: 8,
        include: {
          lead: { select: { id: true, firstName: true, lastName: true } },
          contact: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      prisma.activity.findMany({
        where: { workspaceId },
        orderBy: { date: "desc" },
        take: 12,
        include: {
          owner: { select: { id: true, name: true } },
          lead: { select: { id: true, firstName: true, lastName: true } },
          opportunity: { select: { id: true, name: true } },
        },
      }),
      prisma.opportunity.findMany({
        where: { workspaceId, deletedAt: null },
        orderBy: { updatedAt: "desc" },
        take: 8,
        include: {
          stage: true,
          owner: { select: { id: true, name: true } },
          lead: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      prisma.task.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          status: { in: ["TODO", "IN_PROGRESS"] },
          OR: [
            { priority: { in: ["HIGH", "URGENT"] } },
            { dueAt: { lte: todayEnd } },
          ],
        },
        orderBy: [{ dueAt: "asc" }, { priority: "desc" }],
        take: 10,
        include: {
          lead: { select: { id: true, firstName: true, lastName: true } },
          opportunity: { select: { id: true, name: true } },
        },
      }),
      prisma.lead.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          followUpDue: { lt: todayStart },
          stage: { notIn: ["CONVERTED", "LOST", "ARCHIVED"] },
        },
        orderBy: { followUpDue: "asc" },
        take: 5,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          followUpDue: true,
          stage: true,
          nextAction: true,
        },
      }),
    ]);

    const pipelineValue = openOpps.reduce((sum, o) => sum + toNumber(o.value), 0);
    const weightedPipeline = openOpps.reduce(
      (sum, o) => sum + toNumber(o.value) * (o.probability / 100),
      0,
    );
    const wonRevenue = wonStages.reduce((sum, o) => sum + toNumber(o.value), 0);

    const priorityActions = [
      ...priorityTasks.map((task) => ({
        kind: "task" as const,
        id: task.id,
        title: task.title,
        dueAt: task.dueAt,
        priority: task.priority,
        href: `/tasks`,
        lead: task.lead,
        opportunity: task.opportunity,
      })),
      ...overdueLeads.map((lead) => ({
        kind: "lead_follow_up" as const,
        id: lead.id,
        title: `Follow up: ${lead.firstName}${lead.lastName ? ` ${lead.lastName}` : ""}`,
        dueAt: lead.followUpDue,
        priority: "HIGH" as const,
        href: `/leads/${lead.id}`,
        lead,
        opportunity: null,
      })),
    ].slice(0, 12);

    return jsonOk({
      metrics: {
        newLeads,
        qualified,
        openOpportunities,
        pipelineValue,
        weightedPipeline,
        wonRevenue,
        followUpsDue,
        overdue: overdueTasks + overdueLeads.length,
      },
      priorityActions,
      upcomingSiteVisits,
      recentActivity,
      recentOpportunities,
      demo: isDemoMode(),
    });
  } catch (error) {
    return jsonError(error);
  }
});
