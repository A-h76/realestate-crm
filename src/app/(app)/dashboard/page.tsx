import { Suspense } from "react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatCurrency, formatDatePK, formatDeltaPct } from "@/lib/format";
import { isDemoMode } from "@/lib/demo-mode";
import { SOURCE_COLORS, propertyCover, sourceLabel } from "@/lib/dashboard-ui";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { formatInTimeZone } from "date-fns-tz";
import { headers } from "next/headers";
import { FETCH_TIMEOUTS_MS, fetchWithTimeout } from "@/lib/http";

const KARACHI = "Asia/Karachi";

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, n: number) {
  return new Date(date.getFullYear(), date.getMonth() + n, 1);
}

function startOfWeek(date: Date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d;
}

function relativeAgo(from: Date, now: Date) {
  const hours = Math.max(0, Math.round((now.getTime() - from.getTime()) / 3600000));
  if (hours < 1) return "now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

async function lahoreTemperature() {
  try {
    const incoming = await headers();
    const forceFail =
      process.env.PERF_HTTP_HEADERS === "true" && incoming.get("x-perf-weather") === "fail";
    const res = await fetchWithTimeout(
      forceFail
        ? "http://127.0.0.1:1/open-meteo-fail"
        : "https://api.open-meteo.com/v1/forecast?latitude=31.5204&longitude=74.3587&current=temperature_2m",
      {
        provider: "open-meteo",
        timeoutMs: FETCH_TIMEOUTS_MS.openMeteo,
        ...(forceFail ? {} : { next: { revalidate: 1800 } }),
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { current?: { temperature_2m?: number } };
    return typeof json.current?.temperature_2m === "number" ? json.current.temperature_2m : null;
  } catch {
    return null;
  }
}

async function LahoreTemperatureBadge() {
  const temperature = await lahoreTemperature();
  if (temperature == null) return null;
  return <> · {Math.round(temperature)}°C</>;
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) return null;
  const workspaceId = session.user.workspaceId;
  const now = new Date();
  const monthStart = startOfMonth(now);
  const prevMonthStart = addMonths(monthStart, -1);
  const weekStart = startOfWeek(now);
  const tomorrowStart = new Date(now);
  tomorrowStart.setHours(0, 0, 0, 0);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const tomorrowEnd = new Date(tomorrowStart);
  tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);
  const sixMonthsAgo = addMonths(monthStart, -5);

  const stages = await prisma.pipelineStage.findMany({
    where: { workspaceId, active: true },
    orderBy: { order: "asc" },
  });
  const wonStageIds = stages.filter((s) => s.isWon).map((s) => s.id);
  const openStageIds = stages.filter((s) => !s.isWon && !s.isLost).map((s) => s.id);

  const [
    openOppRows,
    wonThisMonthRows,
    proposals,
    visitsThisWeek,
    upcomingVisits,
    monthLeads,
    recentLeads,
    recentOpps,
    highlightProperties,
    stalledHighValue,
    inboundWa,
    noFollowUpCount,
    createdThisMonth,
    createdLastMonth,
    createdThisWeek,
    trendOpps,
  ] = await Promise.all([
    prisma.opportunity.findMany({
      where: { workspaceId, deletedAt: null, stageId: { in: openStageIds } },
      include: { stage: true },
    }),
    prisma.opportunity.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        stageId: { in: wonStageIds },
        stageEnteredAt: { gte: monthStart },
      },
      select: { value: true },
    }),
    prisma.proposal.findMany({
      where: { workspaceId, deletedAt: null },
      select: { id: true, status: true, viewCount: true, proposalNumber: true, value: true, updatedAt: true },
    }),
    prisma.calendarEvent.count({
      where: {
        workspaceId,
        deletedAt: null,
        type: "SITE_VISIT",
        status: "SCHEDULED",
        startAt: { gte: weekStart },
      },
    }),
    prisma.calendarEvent.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        type: "SITE_VISIT",
        status: "SCHEDULED",
        startAt: { gte: now },
      },
      orderBy: { startAt: "asc" },
      take: 4,
      include: { lead: true },
    }),
    prisma.lead.groupBy({
      by: ["source"],
      where: { workspaceId, deletedAt: null, createdAt: { gte: monthStart } },
      _count: { _all: true },
    }),
    prisma.lead.findMany({
      where: { workspaceId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { owner: { select: { name: true } } },
    }),
    prisma.opportunity.findMany({
      where: { workspaceId, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 5,
      include: { stage: true },
    }),
    prisma.property.findMany({
      where: { workspaceId, deletedAt: null, status: { in: ["AVAILABLE", "RESERVED"] } },
      orderBy: { price: "desc" },
      take: 3,
    }),
    prisma.opportunity.findFirst({
      where: {
        workspaceId,
        deletedAt: null,
        stageId: { in: openStageIds },
        value: { gte: 20000000 },
        stageEnteredAt: { lt: new Date(now.getTime() - 7 * 86400000) },
      },
      include: { stage: true, linkedProperty: true },
    }),
    prisma.whatsAppMessage.findFirst({
      where: { workspaceId, direction: "INBOUND" },
      orderBy: { sentAt: "desc" },
      include: { lead: true },
    }),
    prisma.lead.count({
      where: { workspaceId, deletedAt: null, followUpDue: null, stage: { in: ["NEW", "CONTACTED"] } },
    }),
    prisma.opportunity.aggregate({
      where: { workspaceId, deletedAt: null, createdAt: { gte: monthStart } },
      _sum: { value: true },
    }),
    prisma.opportunity.aggregate({
      where: { workspaceId, deletedAt: null, createdAt: { gte: prevMonthStart, lt: monthStart } },
      _sum: { value: true },
    }),
    prisma.opportunity.count({
      where: { workspaceId, deletedAt: null, createdAt: { gte: weekStart }, stageId: { in: openStageIds } },
    }),
    prisma.opportunity.findMany({
      where: { workspaceId, deletedAt: null, createdAt: { gte: sixMonthsAgo } },
      select: { value: true, probability: true, createdAt: true, stage: { select: { probability: true } } },
    }),
  ]);

  const pipelineValue = openOppRows.reduce((sum, o) => sum + Number(o.value), 0);
  const weighted = openOppRows.reduce(
    (sum, o) => sum + (Number(o.value) * (o.probability || o.stage.probability)) / 100,
    0,
  );
  const thisMonthOpened = Number(createdThisMonth._sum.value ?? 0);
  const lastMonthOpened = Number(createdLastMonth._sum.value ?? 0);
  const pipelineDelta = formatDeltaPct(thisMonthOpened, lastMonthOpened);
  const thisMonthWeighted = trendOpps
    .filter((o) => o.createdAt >= monthStart)
    .reduce((sum, o) => sum + (Number(o.value) * (o.probability || o.stage.probability)) / 100, 0);
  const lastMonthWeighted = trendOpps
    .filter((o) => o.createdAt >= prevMonthStart && o.createdAt < monthStart)
    .reduce((sum, o) => sum + (Number(o.value) * (o.probability || o.stage.probability)) / 100, 0);
  const weightedDelta = formatDeltaPct(thisMonthWeighted, lastMonthWeighted);

  const trend: Array<{ month: string; pipeline: number; weighted: number }> = [];
  for (let i = 0; i < 6; i++) {
    const d = addMonths(sixMonthsAgo, i);
    const bucket = { pipeline: 0, weighted: 0 };
    for (const opp of trendOpps) {
      if (opp.createdAt.getFullYear() === d.getFullYear() && opp.createdAt.getMonth() === d.getMonth()) {
        const value = Number(opp.value);
        bucket.pipeline += value;
        bucket.weighted += (value * (opp.probability || opp.stage.probability)) / 100;
      }
    }
    trend.push({ month: formatInTimeZone(d, KARACHI, "MMM"), pipeline: bucket.pipeline, weighted: bucket.weighted });
  }

  const sourceCounts = monthLeads.length
    ? monthLeads
    : await prisma.lead.groupBy({
        by: ["source"],
        where: { workspaceId, deletedAt: null },
        _count: { _all: true },
      });
  const sources = sourceCounts
    .map((row) => ({
      name: sourceLabel(row.source),
      value: row._count._all,
      color: SOURCE_COLORS[row.source] ?? "#9CA3AF",
    }))
    .sort((a, b) => b.value - a.value);
  const leadTotal = sources.reduce((s, r) => s + r.value, 0);

  const viewed = proposals.filter((p) => p.status === "VIEWED" || p.viewCount > 0);
  const hour = Number(formatInTimeZone(now, KARACHI, "H"));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = (session.user.name ?? "there").split(" ")[0] ?? "there";

  const actions = [];
  if (stalledHighValue) {
    const days = Math.floor((now.getTime() - stalledHighValue.stageEnteredAt.getTime()) / 86400000);
    actions.push({
      tone: "danger" as const,
      title: "High value opportunity idle",
      detail: `${stalledHighValue.linkedProperty?.area ?? stalledHighValue.name} · ${formatCurrency(Number(stalledHighValue.value))} · idle ${days} days`,
      ago: relativeAgo(stalledHighValue.stageEnteredAt, now),
      href: `/opportunities/${stalledHighValue.id}`,
    });
  }
  const soonVisit = upcomingVisits.find((v) => v.startAt < tomorrowEnd);
  if (soonVisit) {
    actions.push({
      tone: "warning" as const,
      title: "Site visit tomorrow",
      detail: `${soonVisit.title} · ${formatInTimeZone(soonVisit.startAt, KARACHI, "HH:mm")}`,
      ago: relativeAgo(soonVisit.createdAt, now),
      href: "/calendar",
    });
  }
  if (viewed[0]) {
    actions.push({
      tone: "brand" as const,
      title: `Proposal viewed ${viewed[0].viewCount} times`,
      detail: `${viewed[0].proposalNumber} · Follow up with client`,
      ago: relativeAgo(viewed[0].updatedAt, now),
      href: "/proposals",
    });
  }
  if (inboundWa?.lead) {
    actions.push({
      tone: "accent" as const,
      title: "New WhatsApp lead",
      detail: inboundWa.lead.whatsappNumber ?? inboundWa.body.slice(0, 42),
      ago: relativeAgo(inboundWa.sentAt, now),
      href: `/leads/${inboundWa.lead.id}`,
    });
  }
  if (noFollowUpCount > 0) {
    actions.push({
      tone: "warning" as const,
      title: `${noFollowUpCount} leads with no follow-up`,
      detail: "Open leads require attention",
      ago: "now",
      href: "/leads",
    });
  }

  const visitsTomorrow = upcomingVisits.filter((v) => v.startAt >= tomorrowStart && v.startAt < tomorrowEnd).length;

  return (
    <DashboardView
      greeting={greeting}
      dateLabel={formatInTimeZone(now, KARACHI, "EEEE, d MMMM yyyy")}
      firstName={firstName}
      temperatureSlot={
        <Suspense fallback={null}>
          <LahoreTemperatureBadge />
        </Suspense>
      }
      pipelineValue={pipelineValue}
      weighted={weighted}
      pipelineDelta={pipelineDelta}
      weightedDelta={weightedDelta}
      openCount={openOppRows.length}
      newThisWeek={createdThisWeek}
      visitsThisWeek={visitsThisWeek}
      visitsTomorrow={visitsTomorrow}
      proposalsCount={proposals.length}
      proposalsViewed={viewed.length}
      wonThisMonth={wonThisMonthRows.reduce((s, o) => s + Number(o.value), 0)}
      wonDealsThisMonth={wonThisMonthRows.length}
      trend={trend}
      sources={sources}
      leadTotal={leadTotal}
      actions={actions.slice(0, 5)}
      recentLeads={recentLeads.map((lead) => ({
        id: lead.id,
        name: `${lead.firstName} ${lead.lastName ?? ""}`.trim(),
        source: sourceLabel(lead.source),
        requirement: [lead.propertyTypePref, lead.preferredArea].filter(Boolean).join(" · ") || "—",
        score: lead.leadScore,
        stage: lead.stage.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()),
        owner: lead.owner?.name?.split(" ")[0] ?? "—",
        date: formatDatePK(lead.createdAt),
      }))}
      recentOpps={recentOpps.map((opp) => ({
        id: opp.id,
        name: opp.name,
        value: Number(opp.value),
        stage: opp.stage.name,
        days: Math.max(0, Math.floor((now.getTime() - opp.stageEnteredAt.getTime()) / 86400000)),
        won: opp.stage.isWon,
      }))}
      properties={highlightProperties.map((p) => ({
        id: p.id,
        title: p.title,
        area: [p.area, p.city].filter(Boolean).join(", "),
        price: Number(p.price),
        status: p.status,
        beds: p.bedrooms,
        baths: p.bathrooms,
        size: p.size != null ? `${p.size} ${p.sizeUnit.charAt(0) + p.sizeUnit.slice(1).toLowerCase()}` : "—",
        cover: propertyCover(p),
      }))}
      visits={upcomingVisits.map((v) => ({
        id: v.id,
        day: formatInTimeZone(v.startAt, KARACHI, "dd"),
        month: formatInTimeZone(v.startAt, KARACHI, "MMM"),
        title: v.title,
        person: v.lead ? `${v.lead.firstName} ${v.lead.lastName ?? ""}`.trim() : "Unassigned",
        time: `${formatInTimeZone(v.startAt, KARACHI, "HH:mm")}${v.endAt ? ` – ${formatInTimeZone(v.endAt, KARACHI, "HH:mm")}` : ""}`,
      }))}
      demoMode={isDemoMode()}
    />
  );
}
