import { formatCurrency } from "@/lib/format";
import { filterAndScoreProperties } from "@/lib/matching/properties";
import { loadLeadContext, leadDisplayName, type LeadContext } from "@/lib/ai/context";

export type NextBestAction = {
  code: string;
  title: string;
  detail: string;
  reason: string;
  href: string;
  priority: "high" | "medium" | "low";
  tone: "danger" | "warning" | "accent";
};

function daysSince(date: Date | null | undefined) {
  if (!date) return 999;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
}

export function computeNextBestAction(ctx: LeadContext): NextBestAction {
  const lead = ctx.lead;
  const name = leadDisplayName(lead);
  const href = `/leads/${lead.id}`;
  const opp = ctx.opportunities.find((o) => !o.stage.isWon && !o.stage.isLost) ?? ctx.opportunities[0];
  const idle = daysSince(lead.lastActivityAt);
  const hasVisit = ctx.calendarEvents.some(
    (e) => e.type === "SITE_VISIT" && (e.status === "SCHEDULED" || e.status === "COMPLETED"),
  );
  const openFollowUp = ctx.tasks.some(
    (t) => t.status === "TODO" && /follow/i.test(t.title),
  );
  const matches = filterAndScoreProperties(lead, ctx.properties);
  const best = matches[0];
  const sellerIncomplete =
    (lead.intentType === "SELL" || opp?.dealSide === "SELLER") &&
    !opp?.linkedPropertyId;

  if (idle >= 14 && lead.stage !== "LOST" && lead.stage !== "ARCHIVED") {
    return {
      code: "REENGAGE_WHATSAPP",
      title: "Re-engage via WhatsApp",
      detail: `${name} idle ${idle} days`,
      reason: "Inactive lead — no recent activity.",
      href,
      priority: "high",
      tone: "danger",
    };
  }

  if (lead.stage === "QUALIFIED" && idle >= 2 && !hasVisit) {
    return {
      code: "CONTACT_LEAD",
      title: "Contact lead",
      detail: `${name} is qualified with no recent activity`,
      reason: "Qualified + no activity.",
      href,
      priority: "high",
      tone: "warning",
    };
  }

  if ((opp?.stage.slug === "discovery" || lead.stage === "QUALIFIED") && !hasVisit && lead.intentType !== "SELL") {
    return {
      code: "SCHEDULE_SITE_VISIT",
      title: "Schedule site visit",
      detail: `${name} · ${lead.preferredArea ?? "area TBC"}`,
      reason: "Discovery / qualified with no site visit.",
      href,
      priority: "high",
      tone: "accent",
    };
  }

  if (opp?.stage.slug === "proposal" && !openFollowUp) {
    return {
      code: "FOLLOW_UP_PROPOSAL",
      title: "Follow up",
      detail: `${opp.name} · ${formatCurrency(Number(opp.value))}`,
      reason: "Proposal stage with no follow-up task.",
      href: `/opportunities/${opp.id}`,
      priority: "high",
      tone: "warning",
    };
  }

  if (opp?.stage.slug === "negotiation" && Number(opp.value) >= 20000000) {
    return {
      code: "CONTACT_DECISION_MAKER",
      title: "Contact decision maker",
      detail: `${opp.name} · ${formatCurrency(Number(opp.value))}`,
      reason: "Negotiation + high value.",
      href: `/opportunities/${opp.id}`,
      priority: "high",
      tone: "danger",
    };
  }

  if (best && best.matchScore >= 80 && (lead.intentType === "BUY" || opp?.dealSide === "BUYER")) {
    return {
      code: "SEND_PROPERTY_OPTIONS",
      title: "Send property options / schedule site visit",
      detail: `${best.matchScore}% match · ${best.property.title}`,
      reason: "Buyer + strong property match.",
      href,
      priority: "high",
      tone: "accent",
    };
  }

  if (sellerIncomplete) {
    return {
      code: "COMPLETE_LISTING",
      title: "Complete property / listing information",
      detail: name,
      reason: "Seller + listing incomplete.",
      href,
      priority: "medium",
      tone: "warning",
    };
  }

  if (lead.followUpDue && lead.followUpDue.getTime() < Date.now()) {
    return {
      code: "OVERDUE_FOLLOW_UP",
      title: "Follow up now",
      detail: `${name} follow-up is overdue`,
      reason: "Follow-up date is in the past.",
      href,
      priority: "high",
      tone: "danger",
    };
  }

  return {
    code: "REVIEW",
    title: ctx.lead.nextAction || "Review lead",
    detail: name,
    reason: "No higher-priority rule matched.",
    href,
    priority: "low",
    tone: "accent",
  };
}

export async function nextBestActionForLead(workspaceId: string, leadId: string) {
  const ctx = await loadLeadContext(workspaceId, leadId);
  if (!ctx) return null;
  return computeNextBestAction(ctx);
}
