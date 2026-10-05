import "server-only";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { Lead, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { CONTACT_ACTIVITY_TYPES } from "@/lib/leads/custody";
import { filterAndScoreProperties } from "@/lib/matching/properties";
import {
  WORKABLE_STAGES,
  buildAttentionItem,
  detectFlags,
  explainPriority,
  leadState,
  rankAttention,
  resolveNextAction,
  type AttentionCategory,
  type AttentionItem,
  type AttentionLead,
  type DayWindow,
  type LeadSignals,
  type LeadState,
  type NextAction,
  type PriorityExplanation,
} from "./rules";

const LEAD_LIMIT = 500;
const OPEN_TASK = ["TODO", "IN_PROGRESS"] as const;

/** The workspace-local calendar day containing `now`. DST-safe: the end is the next local midnight. */
export function localDayWindow(now: Date, timeZone: string): DayWindow {
  const day = formatInTimeZone(now, timeZone, "yyyy-MM-dd");
  const start = fromZonedTime(`${day}T00:00:00`, timeZone);
  const nextDay = formatInTimeZone(new Date(start.getTime() + 36 * 3_600_000), timeZone, "yyyy-MM-dd");
  return { start, end: fromZonedTime(`${nextDay}T00:00:00`, timeZone) };
}

export function toAttentionLead(l: Lead & { owner: { name: string } | null }): AttentionLead {
  return {
    id: l.id,
    name: `${l.firstName} ${l.lastName ?? ""}`.trim(),
    stage: l.stage,
    intentType: l.intentType,
    preferredArea: l.preferredArea,
    ownerId: l.ownerId,
    ownerName: l.owner?.name ?? null,
    createdAt: l.createdAt,
    lastActivityAt: l.lastActivityAt,
    followUpDue: l.followUpDue,
    nextAction: l.nextAction,
  };
}

/**
 * Real timestamps for a batch of leads, in six workspace-scoped queries (no per-lead round trips).
 * Draft and failed outbound messages are not outreach: only messages that actually went out count.
 */
export async function loadLeadSignals(
  workspaceId: string,
  leadIds: string[],
  now: Date,
): Promise<Map<string, LeadSignals>> {
  const signals = new Map<string, LeadSignals>(
    leadIds.map((id) => [
      id,
      { lastInbound: null, lastContactAt: null, openTasks: [], upcomingEvents: [], missedCallAt: null, propertyMatchCount: 0 },
    ]),
  );
  if (leadIds.length === 0) return signals;

  const [messageTimes, inbound, activityTimes, missed, tasks, events] = await Promise.all([
    prisma.whatsAppMessage.groupBy({
      by: ["leadId"],
      where: { workspaceId, leadId: { in: leadIds }, direction: "OUTBOUND", status: { notIn: ["DRAFT", "FAILED"] } },
      _max: { sentAt: true },
    }),
    prisma.whatsAppMessage.findMany({
      where: { workspaceId, leadId: { in: leadIds }, direction: "INBOUND" },
      orderBy: { sentAt: "desc" },
      distinct: ["leadId"],
      select: { leadId: true, body: true, sentAt: true },
    }),
    prisma.activity.groupBy({
      by: ["leadId"],
      where: { workspaceId, leadId: { in: leadIds }, status: "COMPLETED", type: { in: [...CONTACT_ACTIVITY_TYPES] } },
      _max: { date: true },
    }),
    prisma.activity.groupBy({
      by: ["leadId"],
      where: {
        workspaceId,
        leadId: { in: leadIds },
        type: "CALL",
        metadata: { path: ["outcome"], equals: "missed" },
      },
      _max: { date: true },
    }),
    prisma.task.findMany({
      where: { workspaceId, leadId: { in: leadIds }, deletedAt: null, status: { in: [...OPEN_TASK] } },
      select: { id: true, leadId: true, title: true, dueAt: true, owner: { select: { name: true } } },
    }),
    prisma.calendarEvent.findMany({
      where: {
        workspaceId,
        leadId: { in: leadIds },
        deletedAt: null,
        status: "SCHEDULED",
        startAt: { gte: now },
      },
      select: { id: true, leadId: true, title: true, type: true, startAt: true },
    }),
  ]);

  const later = (a: Date | null, b: Date | null | undefined) => (b && (!a || b > a) ? b : a);
  for (const m of messageTimes) {
    const s = m.leadId ? signals.get(m.leadId) : undefined;
    if (s) s.lastContactAt = later(s.lastContactAt, m._max.sentAt);
  }
  for (const a of activityTimes) {
    const s = a.leadId ? signals.get(a.leadId) : undefined;
    if (s) s.lastContactAt = later(s.lastContactAt, a._max.date);
  }
  for (const m of inbound) {
    const s = m.leadId ? signals.get(m.leadId) : undefined;
    if (s) s.lastInbound = { at: m.sentAt, body: m.body };
  }
  for (const a of missed) {
    const s = a.leadId ? signals.get(a.leadId) : undefined;
    if (s) s.missedCallAt = a._max.date;
  }
  for (const t of tasks) {
    signals.get(t.leadId!)?.openTasks.push({ id: t.id, title: t.title, dueAt: t.dueAt, ownerName: t.owner?.name ?? null });
  }
  for (const e of events) {
    signals.get(e.leadId!)?.upcomingEvents.push({ id: e.id, title: e.title, type: e.type, startAt: e.startAt });
  }
  return signals;
}

export type LeadAttentionInfo = {
  state: LeadState;
  flags: AttentionCategory[];
  priority: PriorityExplanation;
  nextAction: NextAction | null;
};

export type HomeScope = "mine" | "team";

export type HomeData = {
  scope: HomeScope;
  respondNow: AttentionItem[];
  followUps: Array<{
    key: string;
    title: string;
    context: string | null;
    dueAt: Date | null;
    overdue: boolean;
    href: string;
    actionLabel: string;
  }>;
  appointments: Array<{
    id: string;
    title: string;
    type: string;
    startAt: Date;
    contactName: string | null;
    href: string;
  }>;
  goingCold: AttentionItem[];
  unassigned: AttentionItem[];
  /** Things needing action: respond-now + follow-ups + going-cold + unassigned. Appointments are informational. */
  attentionCount: number;
  now: Date;
  today: DayWindow;
};

const RESPOND_GROUP = new Set(["RESPOND_NOW", "MISSED_CALL", "NEW_UNCONTACTED"]);
const FOLLOW_GROUP = new Set(["OVERDUE_FOLLOW_UP", "FOLLOW_UP_TODAY"]);

export async function loadHome(
  workspaceId: string,
  userId: string,
  timeZone: string,
  scope: HomeScope,
  now: Date = new Date(),
): Promise<HomeData> {
  const today = localDayWindow(now, timeZone);
  const mine = scope === "mine";

  const leadRows = await prisma.lead.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      stage: { in: [...WORKABLE_STAGES] },
      ...(mine ? { OR: [{ ownerId: userId }, { ownerId: null }] } : {}),
    },
    include: { owner: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: LEAD_LIMIT,
  });

  const signals = await loadLeadSignals(workspaceId, leadRows.map((l) => l.id), now);
  const leads = new Map(leadRows.map((l) => [l.id, l]));

  const items: AttentionItem[] = [];
  for (const row of leadRows) {
    const item = buildAttentionItem(toAttentionLead(row), signals.get(row.id)!, now, today);
    if (item) items.push(item);
  }
  const ranked = rankAttention(items);

  // Property matches only for the leads we are about to show as "respond now" (bounded, deterministic).
  const respondNow = ranked.filter((i) => RESPOND_GROUP.has(i.category)).slice(0, 8);
  if (respondNow.length > 0) {
    const properties = await prisma.property.findMany({
      where: { workspaceId, deletedAt: null, status: "AVAILABLE" },
      take: 300,
    });
    for (const item of respondNow) {
      const row = leads.get(item.leadId)!;
      signals.get(item.leadId)!.propertyMatchCount = filterAndScoreProperties(row, properties).length;
    }
  }

  const ownerTaskScope: Prisma.TaskWhereInput = mine ? { ownerId: userId } : {};
  const standaloneTasks = await prisma.task.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      status: { in: [...OPEN_TASK] },
      leadId: null,
      dueAt: { lt: today.end },
      ...ownerTaskScope,
    },
    orderBy: { dueAt: "asc" },
    take: 10,
    select: {
      id: true,
      title: true,
      dueAt: true,
      opportunity: { select: { id: true, name: true } },
      contact: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  const followUps: HomeData["followUps"] = [
    ...ranked
      .filter((i) => FOLLOW_GROUP.has(i.category))
      .map((i) => ({
        key: `lead:${i.leadId}`,
        title: i.leadName,
        context: i.detail,
        dueAt: i.since,
        overdue: i.category === "OVERDUE_FOLLOW_UP",
        href: i.action.href,
        actionLabel: i.action.label,
      })),
    ...standaloneTasks.map((t) => ({
      key: `task:${t.id}`,
      title: t.title,
      context: t.opportunity?.name ?? (t.contact ? `${t.contact.firstName} ${t.contact.lastName ?? ""}`.trim() : null),
      dueAt: t.dueAt,
      overdue: t.dueAt != null && t.dueAt < today.start,
      href: t.opportunity ? `/opportunities/${t.opportunity.id}` : "/tasks",
      actionLabel: "Open",
    })),
  ].sort((a, b) => (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity));

  const events = await prisma.calendarEvent.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      status: "SCHEDULED",
      startAt: { gte: today.start, lt: today.end },
      ...(mine ? { OR: [{ ownerId: userId }, { ownerId: null }] } : {}),
    },
    orderBy: { startAt: "asc" },
    take: 10,
    select: {
      id: true,
      title: true,
      type: true,
      startAt: true,
      lead: { select: { id: true, firstName: true, lastName: true } },
      contact: { select: { id: true, firstName: true, lastName: true } },
      opportunity: { select: { id: true, name: true } },
    },
  });

  const appointments: HomeData["appointments"] = events.map((e) => {
    const person = e.lead ?? e.contact;
    return {
      id: e.id,
      title: e.title,
      type: e.type,
      startAt: e.startAt,
      contactName: person ? `${person.firstName} ${person.lastName ?? ""}`.trim() : null,
      href: e.lead ? `/leads/${e.lead.id}` : e.opportunity ? `/opportunities/${e.opportunity.id}` : e.contact ? `/contacts/${e.contact.id}` : "/calendar",
    };
  });

  const goingCold = ranked.filter((i) => i.category === "GOING_COLD").slice(0, 6);
  const unassigned = ranked.filter((i) => i.category === "UNASSIGNED").slice(0, 6);
  const respondAll = ranked.filter((i) => RESPOND_GROUP.has(i.category)).length;

  return {
    scope,
    respondNow,
    followUps: followUps.slice(0, 10),
    appointments,
    goingCold,
    unassigned,
    attentionCount:
      respondAll + followUps.length + ranked.filter((i) => i.category === "GOING_COLD" || i.category === "UNASSIGNED").length,
    now,
    today,
  };
}

/** Per-lead state, priority reasons and next action for the Leads list / Lead Details. Workspace-scoped. */
export async function loadLeadAttentionMap(
  workspaceId: string,
  leadRows: Array<Lead & { owner: { name: string } | null }>,
  timeZone: string,
  now: Date = new Date(),
  matchCounts: Map<string, number> = new Map(),
): Promise<Map<string, LeadAttentionInfo>> {
  const today = localDayWindow(now, timeZone);
  const rows = leadRows.slice(0, LEAD_LIMIT * 2);
  const signals = await loadLeadSignals(workspaceId, rows.map((r) => r.id), now);
  const out = new Map<string, LeadAttentionInfo>();
  for (const row of rows) {
    const lead = toAttentionLead(row);
    const s = signals.get(row.id)!;
    s.propertyMatchCount = matchCounts.get(row.id) ?? 0;
    out.set(row.id, {
      state: leadState(lead, s, now, today),
      flags: detectFlags(lead, s, now, today),
      priority: explainPriority(lead, s, now, today),
      nextAction: resolveNextAction(lead, s),
    });
  }
  return out;
}
