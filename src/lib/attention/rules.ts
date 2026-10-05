/**
 * Needs Attention: deterministic, explainable rules over real timestamps.
 *
 * Pure module (no Prisma, no clock except the `now` argument) so every rule is unit-testable
 * and safe to import from client components. No scoring model, no invented response times:
 * every number shown to a user is a difference between two stored timestamps.
 */

export const STALE_DAYS = 14; // active lead with no activity for this long is "going cold"
export const COLD_DAYS = 30; // ... and "cold" after this long
export const STALE_OPPORTUNITY_DAYS = 30;

const MIN = 60_000;
const DAY = 86_400_000;

/** Lead stages that are still being worked. NURTURING is deliberate long-term follow-up, not neglect. */
export const ACTIVE_STAGES = ["NEW", "CONTACTED", "QUALIFIED"] as const;
export const WORKABLE_STAGES = [...ACTIVE_STAGES, "NURTURING"] as const;

export type AttentionCategory =
  | "RESPOND_NOW"
  | "MISSED_CALL"
  | "NEW_UNCONTACTED"
  | "OVERDUE_FOLLOW_UP"
  | "FOLLOW_UP_TODAY"
  | "UNASSIGNED"
  | "GOING_COLD";

export type AttentionLead = {
  id: string;
  name: string;
  stage: string;
  intentType: string;
  preferredArea: string | null;
  ownerId: string | null;
  ownerName: string | null;
  createdAt: Date;
  lastActivityAt: Date | null;
  followUpDue: Date | null;
  nextAction: string | null;
};

export type LeadSignals = {
  /** Newest inbound message, if any. */
  lastInbound: { at: Date; body: string } | null;
  /** Newest outreach from us: outbound message or a completed call/email/meeting/message activity. */
  lastContactAt: Date | null;
  openTasks: Array<{ id: string; title: string; dueAt: Date | null; ownerName: string | null }>;
  upcomingEvents: Array<{ id: string; title: string; type: string; startAt: Date }>;
  /** A call activity explicitly recorded as missed (Activity.metadata.outcome === "missed"). */
  missedCallAt: Date | null;
  propertyMatchCount: number;
};

export type AttentionItem = {
  leadId: string;
  leadName: string;
  category: AttentionCategory;
  /** Lower sorts first. */
  rank: number;
  headline: string;
  detail: string | null;
  /** The real timestamp the headline's elapsed time is measured from. */
  since: Date | null;
  ownerName: string | null;
  action: { label: string; href: string };
  /** Every rule that fired for this lead, most urgent first. */
  flags: AttentionCategory[];
};

const RANK: Record<AttentionCategory, number> = {
  RESPOND_NOW: 1,
  MISSED_CALL: 2,
  NEW_UNCONTACTED: 3,
  OVERDUE_FOLLOW_UP: 4,
  FOLLOW_UP_TODAY: 5,
  UNASSIGNED: 6,
  GOING_COLD: 7,
};

export function isActiveStage(stage: string) {
  return (ACTIVE_STAGES as readonly string[]).includes(stage);
}

export function isWorkableStage(stage: string) {
  return (WORKABLE_STAGES as readonly string[]).includes(stage);
}

/** "6 minutes", "3 hours", "2 days": the gap between two stored timestamps, never a guess. */
export function elapsedLabel(from: Date, now: Date): string {
  const ms = Math.max(0, now.getTime() - from.getTime());
  if (ms < MIN) return "under a minute";
  if (ms < 60 * MIN) return plural(Math.floor(ms / MIN), "minute");
  if (ms < DAY) return plural(Math.floor(ms / (60 * MIN)), "hour");
  return plural(Math.floor(ms / DAY), "day");
}

function plural(n: number, unit: string) {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/** The inbound message is still waiting: we have not contacted the lead since it arrived. */
export function awaitingResponse(s: LeadSignals): boolean {
  if (!s.lastInbound) return false;
  return !s.lastContactAt || s.lastContactAt.getTime() < s.lastInbound.at.getTime();
}

/** Never reached out at all (no outbound message, no completed contact activity). */
export function isUncontacted(lead: AttentionLead, s: LeadSignals): boolean {
  return lead.stage === "NEW" && !s.lastContactAt;
}

/**
 * The follow-up date that counts: the earlier of the lead's own follow-up date and its open
 * tasks' due dates. Used by the overdue / due-today rules.
 */
export function followUpDate(lead: AttentionLead, s: LeadSignals): Date | null {
  const times = [lead.followUpDue, ...s.openTasks.map((t) => t.dueAt)]
    .filter((d): d is Date => d != null)
    .map((d) => d.getTime());
  return times.length ? new Date(Math.min(...times)) : null;
}

export type DayWindow = { start: Date; end: Date };

/** Days since the last real activity (falls back to creation). */
export function staleDays(lead: AttentionLead, now: Date): number {
  const last = lead.lastActivityAt ?? lead.createdAt;
  return Math.floor((now.getTime() - last.getTime()) / DAY);
}

/** Which attention rules fire for a lead right now. `today` is the workspace-local day. */
export function detectFlags(lead: AttentionLead, s: LeadSignals, now: Date, today: DayWindow): AttentionCategory[] {
  if (!isWorkableStage(lead.stage)) return [];
  const flags: AttentionCategory[] = [];

  if (awaitingResponse(s)) flags.push("RESPOND_NOW");
  if (s.missedCallAt && (!s.lastContactAt || s.lastContactAt < s.missedCallAt)) flags.push("MISSED_CALL");
  if (isUncontacted(lead, s) && !awaitingResponse(s)) flags.push("NEW_UNCONTACTED");

  const due = followUpDate(lead, s);
  if (due) {
    if (due.getTime() < today.start.getTime()) flags.push("OVERDUE_FOLLOW_UP");
    else if (due.getTime() < today.end.getTime()) flags.push("FOLLOW_UP_TODAY");
  }

  if (!lead.ownerId) flags.push("UNASSIGNED");

  // Nurture leads are intentionally quiet; going cold only applies to leads we are actively working.
  if (isActiveStage(lead.stage) && s.upcomingEvents.length === 0 && staleDays(lead, now) >= STALE_DAYS) {
    flags.push("GOING_COLD");
  }

  return flags.sort((a, b) => RANK[a] - RANK[b]);
}

export type NextAction = {
  label: string;
  due: Date | null;
  ownerName: string | null;
  reason: string;
  source: "lead" | "task" | "appointment";
};

/**
 * Next action for a lead, from data that already exists: the lead's own nextAction field, else its
 * soonest open task, else its next appointment. Returns null for "No next action": we never invent one.
 */
export function resolveNextAction(lead: AttentionLead, s: LeadSignals): NextAction | null {
  if (lead.nextAction?.trim()) {
    return {
      label: lead.nextAction.trim(),
      due: lead.followUpDue,
      ownerName: lead.ownerName,
      reason: lead.followUpDue ? "Set on this lead" : "Set on this lead, no date",
      source: "lead",
    };
  }
  const tasks = [...s.openTasks].sort(
    (a, b) => (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity),
  );
  if (tasks[0]) {
    return {
      label: tasks[0].title,
      due: tasks[0].dueAt,
      ownerName: tasks[0].ownerName ?? lead.ownerName,
      reason: "Open task",
      source: "task",
    };
  }
  const ev = [...s.upcomingEvents].sort((a, b) => a.startAt.getTime() - b.startAt.getTime())[0];
  if (ev) {
    return { label: ev.title, due: ev.startAt, ownerName: lead.ownerName, reason: "Upcoming appointment", source: "appointment" };
  }
  return null;
}

export type OpportunityActionInput = {
  openTaskCount: number;
  upcomingEventCount: number;
  leadHasNextAction: boolean;
};

/** An open opportunity with nothing planned against it (no task, no appointment, no lead next action). */
export function opportunityLacksNextAction(o: OpportunityActionInput): boolean {
  return o.openTaskCount === 0 && o.upcomingEventCount === 0 && !o.leadHasNextAction;
}

export function isStaleOpportunity(o: { stageEnteredAt: Date; updatedAt: Date }, now: Date): boolean {
  const newest = Math.max(o.stageEnteredAt.getTime(), o.updatedAt.getTime());
  return now.getTime() - newest >= STALE_OPPORTUNITY_DAYS * DAY;
}

const SHOWING_RE = /\b(showing|show me|tour|see the (house|home|place|property)|visit|walk ?through|open house)\b/i;

export type PriorityExplanation = {
  level: "high" | "normal" | "lower";
  reasons: string[];
};

/**
 * Why this lead deserves (or does not deserve) attention. Every reason is derived from stored
 * facts; there is no weighting or score, so the user can verify each line themselves.
 */
export function explainPriority(
  lead: AttentionLead,
  s: LeadSignals,
  now: Date,
  today: DayWindow,
): PriorityExplanation {
  const flags = detectFlags(lead, s, now, today);
  const reasons: string[] = [];
  let high = false;

  if (flags.includes("RESPOND_NOW") && s.lastInbound) {
    high = true;
    reasons.push(`Lead replied ${elapsedLabel(s.lastInbound.at, now)} ago and has no response yet`);
    if (SHOWING_RE.test(s.lastInbound.body)) reasons.push("Showing requested");
  }
  if (flags.includes("MISSED_CALL") && s.missedCallAt) {
    high = true;
    reasons.push(`Missed call ${elapsedLabel(s.missedCallAt, now)} ago`);
  }
  if (flags.includes("NEW_UNCONTACTED")) {
    high = true;
    reasons.push(`New lead, not contacted for ${elapsedLabel(lead.createdAt, now)}`);
  }
  if (flags.includes("OVERDUE_FOLLOW_UP")) {
    high = true;
    reasons.push("Follow-up is overdue");
  } else if (flags.includes("FOLLOW_UP_TODAY")) {
    reasons.push("Follow-up due today");
  }
  const upcoming = [...s.upcomingEvents].sort((a, b) => a.startAt.getTime() - b.startAt.getTime())[0];
  if (upcoming) reasons.push(`Upcoming ${upcoming.type === "SITE_VISIT" ? "showing" : "appointment"}`);
  if (s.propertyMatchCount > 0) {
    reasons.push(`${s.propertyMatchCount} matching ${s.propertyMatchCount === 1 ? "property" : "properties"} available`);
  }
  if (!lead.ownerId) reasons.push("No owner assigned");

  const idle = staleDays(lead, now);
  const lower = !high && isWorkableStage(lead.stage) && idle >= STALE_DAYS && !upcoming;
  if (lower) {
    reasons.push(`No activity for ${idle} days`);
    reasons.push("No upcoming appointment");
  }

  return { level: high ? "high" : lower ? "lower" : "normal", reasons };
}

const HEADLINE: Record<AttentionCategory, string> = {
  RESPOND_NOW: "Waiting for your reply",
  MISSED_CALL: "Missed call",
  NEW_UNCONTACTED: "New lead, not contacted yet",
  OVERDUE_FOLLOW_UP: "Follow-up overdue",
  FOLLOW_UP_TODAY: "Follow up today",
  UNASSIGNED: "No owner yet",
  GOING_COLD: "Going cold",
};

function truncate(text: string, max: number) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** One attention item per lead, built from its most urgent rule. null = nothing needs attention. */
export function buildAttentionItem(
  lead: AttentionLead,
  s: LeadSignals,
  now: Date,
  today: DayWindow,
): AttentionItem | null {
  const flags = detectFlags(lead, s, now, today);
  const category = flags[0];
  if (!category) return null;

  let since: Date | null = null;
  let detail: string | null = null;
  let action = { label: "Open lead", href: `/leads/${lead.id}` };

  switch (category) {
    case "RESPOND_NOW":
      since = s.lastInbound?.at ?? null;
      detail = s.lastInbound ? `“${truncate(s.lastInbound.body, 90)}”` : null;
      action = { label: "Reply", href: `/conversations?lead=${lead.id}` };
      break;
    case "MISSED_CALL":
      since = s.missedCallAt;
      action = { label: "Call back", href: `/leads/${lead.id}` };
      break;
    case "NEW_UNCONTACTED":
      since = lead.createdAt;
      action = { label: "Contact", href: `/leads/${lead.id}` };
      break;
    case "OVERDUE_FOLLOW_UP":
    case "FOLLOW_UP_TODAY":
      since = followUpDate(lead, s);
      detail = resolveNextAction(lead, s)?.label ?? null;
      action = { label: "Follow up", href: `/leads/${lead.id}` };
      break;
    case "UNASSIGNED":
      since = lead.createdAt;
      action = { label: "Assign", href: `/leads/${lead.id}` };
      break;
    case "GOING_COLD":
      since = lead.lastActivityAt ?? lead.createdAt;
      detail = `No activity for ${staleDays(lead, now)} days`;
      action = { label: "Re-engage", href: `/leads/${lead.id}` };
      break;
  }

  return {
    leadId: lead.id,
    leadName: lead.name,
    category,
    rank: RANK[category],
    headline: HEADLINE[category],
    detail,
    since,
    ownerName: lead.ownerName,
    action,
    flags,
  };
}

/** Ranked list: most urgent category first, oldest wait first within a category. */
export function rankAttention(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort(
    (a, b) =>
      a.rank - b.rank ||
      (a.since?.getTime() ?? Infinity) - (b.since?.getTime() ?? Infinity) ||
      a.leadName.localeCompare(b.leadName),
  );
}

/**
 * Client-facing lead state built from the existing stage field plus the attention rules.
 * No second state system: Nurture/Lost/Converted are LeadStage values; Needs Attention and Cold
 * are derived views.
 */
export type LeadState = "Active" | "Needs Attention" | "Nurture" | "Cold" | "Lost" | "Converted";

export function leadState(lead: AttentionLead, s: LeadSignals, now: Date, today: DayWindow): LeadState {
  if (lead.stage === "LOST" || lead.stage === "ARCHIVED") return "Lost";
  if (lead.stage === "CONVERTED") return "Converted";
  const flags = detectFlags(lead, s, now, today);
  if (lead.stage === "NURTURING") return flags.includes("RESPOND_NOW") ? "Needs Attention" : "Nurture";
  if (staleDays(lead, now) >= COLD_DAYS && s.upcomingEvents.length === 0) return "Cold";
  return flags.length > 0 ? "Needs Attention" : "Active";
}
