import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { loadLeadContext } from "@/lib/ai/context";
import { filterAndScoreProperties } from "@/lib/matching/properties";
import { measureExecution } from "@/lib/perf";

export type ScoreBreakdown = {
  fit: number;
  intent: number;
  value: number;
  engagement: number;
  propertyFit: number;
  response: number;
  pipeline: number;
  siteVisit: number;
  leadScore: number;
  reasons: string[];
};

function clamp(n: number) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function daysSince(date: Date | null | undefined) {
  if (!date) return 999;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
}

function num(value: { toString(): string } | number | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value.toString());
  return Number.isNaN(n) ? null : n;
}

export function computeLeadScore(input: {
  lead: {
    stage: string;
    intentType: string;
    preferredArea: string | null;
    propertyTypePref: string | null;
    propertyPurpose: string | null;
    budgetMin: { toString(): string } | number | null;
    budgetMax: { toString(): string } | number | null;
    estimatedValue: { toString(): string } | number | null;
    timeline: string | null;
    lastActivityAt: Date | null;
    followUpDue: Date | null;
    notes: string | null;
  };
  whatsappCount: number;
  inboundCount: number;
  outboundCount: number;
  activityCount: number;
  hasSiteVisit: boolean;
  pipelineSlug: string | null;
  bestPropertyMatch: number;
}): ScoreBreakdown {
  const reasons: string[] = [];
  let fit = 28;
  if (input.lead.preferredArea) {
    fit += 18;
    reasons.push("Preferred area is on file.");
  }
  if (input.lead.propertyTypePref) fit += 14;
  if (input.lead.propertyPurpose) fit += 12;
  if (input.lead.intentType !== "UNKNOWN") fit += 10;
  if (input.bestPropertyMatch >= 80) {
    fit += 12;
    reasons.push("Strong inventory match against available listings.");
  } else if (input.bestPropertyMatch >= 60) {
    fit += 6;
  }

  let intent = 20;
  switch (input.lead.stage) {
    case "NEW":
      intent += 8;
      break;
    case "CONTACTED":
      intent += 16;
      break;
    case "QUALIFIED":
      intent += 28;
      reasons.push("Lead is qualified.");
      break;
    case "NURTURING":
      intent += 18;
      break;
    case "CONVERTED":
      intent += 36;
      break;
    case "LOST":
    case "ARCHIVED":
      intent -= 10;
      break;
    default:
      intent += 8;
  }
  if (input.lead.timeline) {
    intent += /immediate|7|14|30|45/i.test(input.lead.timeline) ? 16 : 8;
  }
  if (input.lead.notes && input.lead.notes.length > 20) intent += 6;

  let value = 20;
  const est = num(input.lead.estimatedValue) ?? num(input.lead.budgetMax) ?? 0;
  if (est >= 80000000) {
    value = 92;
    reasons.push("High estimated deal value.");
  } else if (est >= 40000000) {
    value = 78;
  } else if (est >= 15000000) {
    value = 62;
  } else if (est > 0) {
    value = 48;
  }

  let engagement = 18;
  if (input.activityCount >= 8) engagement += 24;
  else if (input.activityCount >= 3) engagement += 14;
  else if (input.activityCount >= 1) engagement += 6;
  const idle = daysSince(input.lead.lastActivityAt);
  if (idle <= 2) engagement += 20;
  else if (idle <= 7) engagement += 10;
  else if (idle > 21) engagement -= 12;

  let response = 15;
  if (input.inboundCount > 0 && input.outboundCount > 0) {
    response += 30;
    reasons.push("Lead responded on WhatsApp.");
  } else if (input.whatsappCount > 0) {
    response += 12;
  }
  if (input.lead.followUpDue && input.lead.followUpDue.getTime() < Date.now()) response -= 8;

  let pipeline = 10;
  switch (input.pipelineSlug) {
    case "qualified":
      pipeline = 28;
      break;
    case "discovery":
      pipeline = 40;
      break;
    case "solution":
      pipeline = 52;
      break;
    case "proposal":
      pipeline = 68;
      break;
    case "negotiation":
      pipeline = 82;
      reasons.push("Opportunity is in negotiation.");
      break;
    case "won":
      pipeline = 100;
      break;
    default:
      pipeline = 16;
  }

  const siteVisit = input.hasSiteVisit ? 88 : 12;
  if (input.hasSiteVisit) reasons.push("Lead scheduled a site visit.");

  const leadScore = clamp(
    fit * 0.22 +
      intent * 0.2 +
      value * 0.18 +
      engagement * 0.12 +
      input.bestPropertyMatch * 0.1 +
      response * 0.08 +
      pipeline * 0.06 +
      siteVisit * 0.04,
  );

  return {
    fit: clamp(fit),
    intent: clamp(intent),
    value: clamp(value),
    engagement: clamp(engagement),
    propertyFit: clamp(input.bestPropertyMatch),
    response: clamp(response),
    pipeline: clamp(pipeline),
    siteVisit: clamp(siteVisit),
    leadScore,
    reasons: reasons.slice(0, 4),
  };
}

export async function scoreLead(input: {
  workspaceId: string;
  leadId: string;
  actorId?: string | null;
  reasonOverride?: string;
}) {
  const ctx = await measureExecution("score.inputPrep", () =>
    loadLeadContext(input.workspaceId, input.leadId),
  );
  if (!ctx) return null;

  const breakdown = await measureExecution("score.analysis", async () => {
    const matches = filterAndScoreProperties(ctx.lead, ctx.properties);
    const bestPropertyMatch = matches[0]?.matchScore ?? 0;
    const inboundCount = ctx.whatsapp.filter((m) => m.direction === "INBOUND").length;
    const outboundCount = ctx.whatsapp.filter((m) => m.direction === "OUTBOUND").length;
    const hasSiteVisit = ctx.calendarEvents.some(
      (e) => e.type === "SITE_VISIT" && e.status !== "CANCELLED",
    );
    const pipelineSlug = ctx.opportunities[0]?.stage.slug ?? null;
    return {
      matches,
      previousScore: ctx.lead.leadScore,
      breakdown: computeLeadScore({
        lead: ctx.lead,
        whatsappCount: ctx.whatsapp.length,
        inboundCount,
        outboundCount,
        activityCount: ctx.activities.length,
        hasSiteVisit,
        pipelineSlug,
        bestPropertyMatch,
      }),
    };
  });

  const reason =
    input.reasonOverride ??
    (breakdown.breakdown.reasons[0]
      ? breakdown.breakdown.reasons.join(" ")
      : "Deterministic score refreshed from CRM signals.");

  const persist = await measureExecution("score.persist", async () => {
    const updated = await prisma.lead.updateMany({
      where: { id: ctx.lead.id, workspaceId: input.workspaceId, deletedAt: null },
      data: {
        leadScore: breakdown.breakdown.leadScore,
        fitScore: breakdown.breakdown.fit,
        intentScore: breakdown.breakdown.intent,
        valueScore: breakdown.breakdown.value,
      },
    });
    if (updated.count === 0) return null;
    const lead = await prisma.lead.findFirstOrThrow({
      where: { id: ctx.lead.id, workspaceId: input.workspaceId },
    });

    const history = await prisma.scoreHistory.create({
      data: {
        workspaceId: input.workspaceId,
        leadId: lead.id,
        previousScore: breakdown.previousScore,
        newScore: breakdown.breakdown.leadScore,
        fitScore: breakdown.breakdown.fit,
        intentScore: breakdown.breakdown.intent,
        valueScore: breakdown.breakdown.value,
        reason,
        signals: breakdown.breakdown as unknown as Prisma.InputJsonValue,
      },
    });

    await writeAudit({
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      action: "SCORE_UPDATED",
      entity: "Lead",
      entityId: lead.id,
      metadata: {
        previousScore: breakdown.previousScore,
        newScore: breakdown.breakdown.leadScore,
        reason,
      },
    });

    return { lead, history };
  });
  if (!persist) return null;

  return {
    lead: persist.lead,
    breakdown: breakdown.breakdown,
    history: persist.history,
    previousScore: breakdown.previousScore,
    matches: breakdown.matches,
  };
}
