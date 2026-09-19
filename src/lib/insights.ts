import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type ReportRange = {
  from: Date | null;
  to: Date | null;
};

function inRange(field: "createdAt" | "updatedAt" | "date" | "sentAt", range: ReportRange): Prisma.DateTimeFilter | undefined {
  if (!range.from && !range.to) return undefined;
  return {
    gte: range.from ?? undefined,
    lte: range.to ?? undefined,
  };
}

export function resolveReportRange(preset: string, from?: string | null, to?: string | null): ReportRange {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  if (preset === "today") return { from: startOfToday, to: now };
  if (preset === "7d") return { from: new Date(now.getTime() - 7 * 86400000), to: now };
  if (preset === "30d") return { from: new Date(now.getTime() - 30 * 86400000), to: now };
  if (preset === "90d") return { from: new Date(now.getTime() - 90 * 86400000), to: now };
  if (preset === "custom") {
    return {
      from: from ? new Date(from) : null,
      to: to ? new Date(to) : null,
    };
  }
  return { from: null, to: null };
}

function num(value: { toString(): string } | number | null | undefined) {
  if (value == null) return 0;
  return typeof value === "number" ? value : Number(value.toString());
}

export async function workspaceInsights(workspaceId: string, range: ReportRange) {
  const createdAt = inRange("createdAt", range);
  const leadWhere: Prisma.LeadWhereInput = { workspaceId, deletedAt: null, ...(createdAt ? { createdAt } : {}) };
  const oppWhere: Prisma.OpportunityWhereInput = { workspaceId, deletedAt: null, ...(createdAt ? { createdAt } : {}) };

  const [
    leads,
    opportunities,
    stages,
    activities,
    tasks,
    proposals,
    whatsapp,
    properties,
    matchRuns,
  ] = await Promise.all([
    prisma.lead.findMany({
      where: leadWhere,
      select: {
        id: true,
        source: true,
        industry: true,
        preferredArea: true,
        stage: true,
        estimatedValue: true,
        createdAt: true,
        ownerId: true,
      },
    }),
    prisma.opportunity.findMany({
      where: oppWhere,
      include: { stage: true, linkedProperty: true },
    }),
    prisma.pipelineStage.findMany({ where: { workspaceId, active: true }, orderBy: { order: "asc" } }),
    prisma.activity.findMany({
      where: { workspaceId, ...(inRange("date", range) ? { date: inRange("date", range) } : {}) },
      select: { type: true, ownerId: true, date: true },
    }),
    prisma.task.findMany({
      where: { workspaceId, deletedAt: null, ...(createdAt ? { createdAt } : {}) },
      select: { status: true, dueAt: true, completedAt: true, ownerId: true },
    }),
    prisma.proposal.findMany({
      where: { workspaceId, deletedAt: null, ...(createdAt ? { createdAt } : {}) },
      select: { status: true, viewCount: true, value: true, linkedPropertyId: true },
    }),
    prisma.whatsAppMessage.findMany({
      where: { workspaceId, ...(inRange("sentAt", range) ? { sentAt: inRange("sentAt", range) } : {}) },
      select: { direction: true, conversationId: true, sentAt: true, leadId: true },
    }),
    prisma.property.findMany({
      where: { workspaceId, deletedAt: null },
      select: { id: true, area: true, status: true },
    }),
    prisma.intelligenceRun.count({
      where: { workspaceId, kind: "PROPERTY_MATCH" },
    }),
  ]);

  const sourceCounts: Record<string, number> = {};
  for (const lead of leads) sourceCounts[lead.source] = (sourceCounts[lead.source] ?? 0) + 1;

  const industryCounts: Record<string, { leads: number; value: number }> = {};
  for (const lead of leads) {
    const key = lead.industry || lead.preferredArea || "Unspecified";
    industryCounts[key] ??= { leads: 0, value: 0 };
    industryCounts[key].leads += 1;
    industryCounts[key].value += num(lead.estimatedValue);
  }

  const won = opportunities.filter((o) => o.stage.isWon);
  const lost = opportunities.filter((o) => o.stage.isLost);
  const open = opportunities.filter((o) => !o.stage.isWon && !o.stage.isLost);
  const convertedLeads = leads.filter((l) => l.stage === "CONVERTED").length;
  const conversionRate = leads.length ? convertedLeads / leads.length : 0;
  const oppWinRate = opportunities.length ? won.length / opportunities.length : 0;
  const avgDealSize = won.length ? won.reduce((s, o) => s + num(o.value), 0) / won.length : 0;

  const cycleDays = won.map((o) => Math.max(0, (o.updatedAt.getTime() - o.createdAt.getTime()) / 86400000));
  const salesCycle = cycleDays.length ? cycleDays.reduce((a, b) => a + b, 0) / cycleDays.length : 0;

  const stageConversion = stages.map((stage, i) => {
    const count = opportunities.filter((o) => o.stageId === stage.id).length;
    const prev = i === 0 ? leads.length : opportunities.filter((o) => o.stage.order <= stages[i - 1].order).length;
    return {
      stage: stage.name,
      count,
      conversionFromPrevious: prev ? count / prev : 0,
    };
  });

  const lostReasons: Record<string, number> = {};
  for (const o of lost) {
    const key = o.lostReason || "Unspecified";
    lostReasons[key] = (lostReasons[key] ?? 0) + 1;
  }

  const now = new Date();
  const overdueFollowUps = tasks.filter(
    (t) => t.status !== "DONE" && t.status !== "CANCELLED" && t.dueAt && t.dueAt < now,
  ).length;
  const completedFollowUps = tasks.filter((t) => t.status === "DONE").length;

  const byConvo = new Map<string, { out: Date[]; inn: Date[] }>();
  for (const m of whatsapp) {
    const row = byConvo.get(m.conversationId) ?? { out: [], inn: [] };
    if (m.direction === "OUTBOUND") row.out.push(m.sentAt);
    if (m.direction === "INBOUND") row.inn.push(m.sentAt);
    byConvo.set(m.conversationId, row);
  }
  let responded = 0;
  let outboundThreads = 0;
  for (const row of byConvo.values()) {
    if (row.out.length === 0) continue;
    outboundThreads += 1;
    const firstOut = Math.min(...row.out.map((d) => d.getTime()));
    if (row.inn.some((d) => d.getTime() > firstOut)) responded += 1;
  }
  const whatsappResponseRate = outboundThreads ? responded / outboundThreads : 0;

  const agingBuckets = { d0_7: 0, d8_14: 0, d15_30: 0, d31_60: 0, d60p: 0 };
  const stalled = [];
  for (const o of open) {
    const days = Math.floor((now.getTime() - o.stageEnteredAt.getTime()) / 86400000);
    if (days <= 7) agingBuckets.d0_7 += 1;
    else if (days <= 14) agingBuckets.d8_14 += 1;
    else if (days <= 30) agingBuckets.d15_30 += 1;
    else if (days <= 60) agingBuckets.d31_60 += 1;
    else agingBuckets.d60p += 1;
    if (days >= 14) {
      stalled.push({
        id: o.id,
        name: o.name,
        value: num(o.value),
        daysInStage: days,
        stage: o.stage.name,
        ownerId: o.ownerId,
      });
    }
  }

  const ownerActivity: Record<string, number> = {};
  for (const a of activities) {
    if (!a.ownerId) continue;
    ownerActivity[a.ownerId] = (ownerActivity[a.ownerId] ?? 0) + 1;
  }

  const wonWithProperty = won.filter((o) => o.linkedPropertyId).length;
  const propertyMatchConversion = matchRuns ? wonWithProperty / Math.max(matchRuns, 1) : 0;

  return {
    totals: {
      leads: leads.length,
      opportunities: opportunities.length,
      open: open.length,
      won: won.length,
      lost: lost.length,
      properties: properties.length,
    },
    leadSources: sourceCounts,
    conversionRates: {
      leadToConverted: conversionRate,
      opportunityWin: oppWinRate,
    },
    industryArea: industryCounts,
    averageDealSize: avgDealSize,
    salesCycleDays: salesCycle,
    stageConversion,
    lostReasons,
    followUp: {
      overdue: overdueFollowUps,
      completed: completedFollowUps,
      open: tasks.filter((t) => t.status === "TODO" || t.status === "IN_PROGRESS").length,
    },
    whatsappResponseRate,
    activityVolume: activities.length,
    pipelineAging: agingBuckets,
    stalled: stalled.sort((a, b) => b.daysInStage - a.daysInStage).slice(0, 12),
    ownerActivity,
    propertyMatchConversion,
    proposals: {
      viewed: proposals.filter((p) => p.status === "VIEWED" || p.viewCount > 0).length,
      sent: proposals.filter((p) => p.status !== "DRAFT").length,
      total: proposals.length,
    },
  };
}

export type PipelineAgingRow = {
  id: string;
  name: string;
  value: number;
  probability: number;
  daysInStage: number;
  lastActivity: Date | null;
  nextAction: string | null;
  ownerName: string | null;
  stageName: string;
  leadName: string | null;
};

export async function pipelineAging(workspaceId: string): Promise<PipelineAgingRow[]> {
  const opps = await prisma.opportunity.findMany({
    where: { workspaceId, deletedAt: null, stage: { isWon: false, isLost: false } },
    include: {
      stage: true,
      owner: { select: { name: true } },
      lead: { select: { firstName: true, lastName: true, nextAction: true, lastActivityAt: true } },
      activities: { orderBy: { date: "desc" }, take: 1 },
    },
    orderBy: { stageEnteredAt: "asc" },
  });
  const now = new Date();
  return opps.map((o) => ({
    id: o.id,
    name: o.name,
    value: num(o.value),
    probability: o.probability,
    daysInStage: Math.max(0, Math.floor((now.getTime() - o.stageEnteredAt.getTime()) / 86400000)),
    lastActivity: o.activities[0]?.date ?? o.lead?.lastActivityAt ?? o.updatedAt,
    nextAction: o.lead?.nextAction ?? null,
    ownerName: o.owner?.name ?? null,
    stageName: o.stage.name,
    leadName: o.lead ? `${o.lead.firstName} ${o.lead.lastName ?? ""}`.trim() : null,
  }));
}
