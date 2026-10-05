import "server-only";
import { prisma } from "@/lib/db";
import { countDuplicateGroups } from "./hygiene";
import { loadLeadSignals, localDayWindow, toAttentionLead } from "./loader";
import {
  WORKABLE_STAGES,
  detectFlags,
  isActiveStage,
  isStaleOpportunity,
  isUncontacted,
  opportunityLacksNextAction,
  type AttentionCategory,
} from "./rules";

const LEAD_LIMIT = 2000;
const FLOW_DAYS = 30;
/** Below this many leads in the window, step counts are shown but the flow is labelled as too small to read. */
const FLOW_MIN_LEADS = 5;
const OPEN_TASK = ["TODO", "IN_PROGRESS"] as const;

export type AgentWorkload = {
  userId: string | null;
  name: string;
  openLeads: number;
  needsReply: number;
  overdueFollowUps: number;
  noNextAction: number;
};

export type FlowStep = { label: string; count: number | null };

export type TeamHealth = {
  generatedAt: Date;
  /** Counts straight from current rows. */
  followUpHealth: {
    unassigned: number;
    uncontacted: number;
    oldestUncontactedDays: number | null;
    needsReply: number;
    overdueFollowUps: number;
    goingCold: number;
    opportunitiesWithoutNextAction: number;
  };
  workload: AgentWorkload[];
  leadFlow: { windowDays: number; cohort: number; steps: FlowStep[]; enoughData: boolean };
  dataHealth: DataHealth;
};

export type DataHealth = {
  leadsWithoutOwner: number;
  leadsWithoutNextAction: number;
  leadsWithoutContactInfo: number;
  duplicateContactGroups: number;
  staleOpportunities: number;
};

export async function loadTeamHealth(workspaceId: string, timeZone: string, now: Date = new Date()): Promise<TeamHealth> {
  const today = localDayWindow(now, timeZone);

  const [leadRows, contacts, openOpps, members, stages] = await Promise.all([
    prisma.lead.findMany({
      where: { workspaceId, deletedAt: null, stage: { in: [...WORKABLE_STAGES] } },
      include: { owner: { select: { name: true } } },
      take: LEAD_LIMIT,
    }),
    prisma.contact.findMany({
      where: { workspaceId, deletedAt: null },
      select: { id: true, phone: true, email: true },
      take: 5000,
    }),
    prisma.opportunity.findMany({
      where: { workspaceId, deletedAt: null, stage: { isWon: false, isLost: false } },
      select: { id: true, leadId: true, stageEnteredAt: true, updatedAt: true },
      take: LEAD_LIMIT,
    }),
    prisma.workspaceMember.findMany({
      where: { workspaceId, role: { in: ["OWNER", "ADMIN", "MANAGER", "AGENT"] } },
      select: { userId: true, user: { select: { name: true } } },
    }),
    prisma.pipelineStage.findMany({ where: { workspaceId, active: true }, select: { id: true, slug: true, name: true, isWon: true } }),
  ]);

  const ids = leadRows.map((l) => l.id);
  const signals = await loadLeadSignals(workspaceId, ids, now);
  const oppIds = openOpps.map((o) => o.id);
  const [oppTasks, oppEvents] = await Promise.all([
    prisma.task.groupBy({
      by: ["opportunityId"],
      where: { workspaceId, opportunityId: { in: oppIds }, deletedAt: null, status: { in: [...OPEN_TASK] } },
      _count: { _all: true },
    }),
    prisma.calendarEvent.groupBy({
      by: ["opportunityId"],
      where: { workspaceId, opportunityId: { in: oppIds }, deletedAt: null, status: "SCHEDULED", startAt: { gte: now } },
      _count: { _all: true },
    }),
  ]);
  const taskCount = new Map(oppTasks.map((t) => [t.opportunityId, t._count._all]));
  const eventCount = new Map(oppEvents.map((t) => [t.opportunityId, t._count._all]));

  const workloadByOwner = new Map<string | null, AgentWorkload>();
  const nameOf = new Map(members.map((m) => [m.userId, m.user.name]));
  const bucket = (ownerId: string | null) => {
    let w = workloadByOwner.get(ownerId);
    if (!w) {
      w = {
        userId: ownerId,
        name: ownerId ? (nameOf.get(ownerId) ?? "Former member") : "Unassigned",
        openLeads: 0,
        needsReply: 0,
        overdueFollowUps: 0,
        noNextAction: 0,
      };
      workloadByOwner.set(ownerId, w);
    }
    return w;
  };
  for (const m of members) bucket(m.userId);

  const f = { unassigned: 0, uncontacted: 0, needsReply: 0, overdue: 0, cold: 0 };
  let oldestUncontacted: number | null = null;
  let withoutNextAction = 0;
  let withoutContactInfo = 0;
  const leadsWithNextAction = new Set<string>();

  for (const row of leadRows) {
    const lead = toAttentionLead(row);
    const s = signals.get(row.id)!;
    const flags = new Set<AttentionCategory>(detectFlags(lead, s, now, today));
    const w = bucket(row.ownerId);
    w.openLeads++;
    if (flags.has("UNASSIGNED")) f.unassigned++;
    if (isUncontacted(lead, s)) {
      f.uncontacted++;
      const days = Math.floor((now.getTime() - row.createdAt.getTime()) / 86_400_000);
      oldestUncontacted = Math.max(oldestUncontacted ?? 0, days);
    }
    if (flags.has("RESPOND_NOW")) {
      f.needsReply++;
      w.needsReply++;
    }
    if (flags.has("OVERDUE_FOLLOW_UP")) {
      f.overdue++;
      w.overdueFollowUps++;
    }
    if (flags.has("GOING_COLD")) f.cold++;
    const hasNext = Boolean(row.nextAction?.trim()) || s.openTasks.length > 0 || s.upcomingEvents.length > 0;
    if (hasNext) leadsWithNextAction.add(row.id);
    else if (isActiveStage(row.stage)) {
      withoutNextAction++;
      w.noNextAction++;
    }
    if (!row.phone && !row.whatsappNumber && !row.email) withoutContactInfo++;
  }

  const oppsWithoutNext = openOpps.filter((o) =>
    opportunityLacksNextAction({
      openTaskCount: taskCount.get(o.id) ?? 0,
      upcomingEventCount: eventCount.get(o.id) ?? 0,
      leadHasNextAction: o.leadId ? leadsWithNextAction.has(o.leadId) : false,
    }),
  ).length;

  const workload = [...workloadByOwner.values()]
    .filter((w) => w.userId !== null || w.openLeads > 0)
    .sort((a, b) => b.needsReply + b.overdueFollowUps - (a.needsReply + a.overdueFollowUps) || b.openLeads - a.openLeads);

  return {
    generatedAt: now,
    followUpHealth: {
      unassigned: f.unassigned,
      uncontacted: f.uncontacted,
      oldestUncontactedDays: oldestUncontacted,
      needsReply: f.needsReply,
      overdueFollowUps: f.overdue,
      goingCold: f.cold,
      opportunitiesWithoutNextAction: oppsWithoutNext,
    },
    workload,
    leadFlow: await loadLeadFlow(workspaceId, stages, now),
    dataHealth: {
      leadsWithoutOwner: f.unassigned,
      leadsWithoutNextAction: withoutNextAction,
      leadsWithoutContactInfo: withoutContactInfo,
      duplicateContactGroups: countDuplicateGroups(contacts),
      staleOpportunities: openOpps.filter((o) => isStaleOpportunity(o, now)).length,
    },
  };
}

/**
 * Lead flow for leads created in the last 30 days. Each step is a plain count of those leads that
 * satisfy it today, from rows that exist. Offer/Closed need pipeline stages named for them; if the
 * workspace has none, that step is null (rendered "Not enough activity data yet"), never zero-filled.
 * No percentages: the cohort is small and the steps are not nested.
 */
async function loadLeadFlow(
  workspaceId: string,
  stages: Array<{ id: string; slug: string; name: string; isWon: boolean }>,
  now: Date,
): Promise<TeamHealth["leadFlow"]> {
  const since = new Date(now.getTime() - FLOW_DAYS * 86_400_000);
  const cohort = await prisma.lead.findMany({
    where: { workspaceId, deletedAt: null, createdAt: { gte: since } },
    select: { id: true, ownerId: true, stage: true },
    take: LEAD_LIMIT,
  });
  const ids = cohort.map((l) => l.id);
  if (ids.length === 0) return { windowDays: FLOW_DAYS, cohort: 0, steps: [], enoughData: false };

  const offerStageIds = stages.filter((s) => /offer|contract/i.test(`${s.slug} ${s.name}`)).map((s) => s.id);
  const wonStageIds = stages.filter((s) => s.isWon).map((s) => s.id);

  const [contacted, outbound, showings, opps] = await Promise.all([
    prisma.activity.findMany({
      where: { workspaceId, leadId: { in: ids }, status: "COMPLETED", type: { in: ["CALL", "EMAIL", "MEETING", "WHATSAPP_MESSAGE"] } },
      distinct: ["leadId"],
      select: { leadId: true },
    }),
    prisma.whatsAppMessage.findMany({
      where: { workspaceId, leadId: { in: ids }, direction: "OUTBOUND", status: { notIn: ["DRAFT", "FAILED"] } },
      distinct: ["leadId"],
      select: { leadId: true },
    }),
    prisma.calendarEvent.findMany({
      where: { workspaceId, leadId: { in: ids }, deletedAt: null, type: "SITE_VISIT", status: { in: ["SCHEDULED", "COMPLETED"] } },
      distinct: ["leadId"],
      select: { leadId: true },
    }),
    prisma.opportunity.findMany({
      where: { workspaceId, leadId: { in: ids }, deletedAt: null },
      select: { leadId: true, stageId: true },
    }),
  ]);

  const contactedIds = new Set([...contacted, ...outbound].map((r) => r.leadId));
  const withOpp = new Set(opps.map((o) => o.leadId));
  const qualified = cohort.filter((l) => l.stage === "QUALIFIED" || l.stage === "CONVERTED" || withOpp.has(l.id)).length;
  const inStages = (stageIds: string[]) =>
    new Set(opps.filter((o) => stageIds.includes(o.stageId)).map((o) => o.leadId)).size;

  return {
    windowDays: FLOW_DAYS,
    cohort: cohort.length,
    enoughData: cohort.length >= FLOW_MIN_LEADS,
    steps: [
      { label: "New leads", count: cohort.length },
      { label: "Assigned", count: cohort.filter((l) => l.ownerId).length },
      { label: "Contacted", count: cohort.filter((l) => contactedIds.has(l.id)).length },
      { label: "Qualified", count: qualified },
      { label: "Showing", count: showings.length },
      { label: "Offer", count: offerStageIds.length ? inStages(offerStageIds) : null },
      { label: "Closed", count: wonStageIds.length ? inStages(wonStageIds) : null },
    ],
  };
}
