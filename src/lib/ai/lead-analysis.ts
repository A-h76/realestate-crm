import { formatMoney } from "@/lib/format";
import { filterAndScoreProperties } from "@/lib/matching/properties";
import { loadLeadContext, leadDisplayName, type LeadContext } from "./context";
import { leadAnalysisSchema, parseAiOutput, type LeadAnalysis } from "./schemas";
import { storeIntelligenceRun } from "./store";
import { measureExecution } from "@/lib/perf";

function analysisFromContext(ctx: LeadContext): LeadAnalysis {
  const lead = ctx.lead;
  const name = leadDisplayName(lead);
  const matches = filterAndScoreProperties(lead, ctx.properties);
  const best = matches[0];
  const opp = ctx.opportunities[0];
  const inbound = ctx.whatsapp.filter((m) => m.direction === "INBOUND");
  const hasVisit = ctx.calendarEvents.some((e) => e.type === "SITE_VISIT" && e.status !== "CANCELLED");

  const niche = [lead.preferredArea, lead.propertyTypePref, lead.intentType]
    .filter(Boolean)
    .join(" · ") || "Unspecified residential";

  const likelyNeed = lead.intentType === "SELL"
    ? "Complete listing information and buyer shortlist"
    : hasVisit
      ? "Confirm showing and share matching listings"
      : best
        ? `Review ${best.property.area ?? "shortlisted"} inventory against budget`
        : "Qualify property need, location, and budget";

  const painPoints = [
    lead.budgetMax ? `Budget ceiling ${formatMoney(Number(lead.budgetMax))}` : null,
    lead.timeline ? `Timeline: ${lead.timeline}` : "Timeline not confirmed",
    inbound.length === 0 ? "Limited reply history" : null,
    !hasVisit && lead.intentType === "BUY" ? "No showing scheduled yet" : null,
    lead.preferredArea ? `Area constraint: ${lead.preferredArea}` : "Area preference open",
  ].filter((v): v is string => Boolean(v));

  const recommendedAction = hasVisit
    ? "Prepare showing brief and send listing options"
    : best && best.matchScore >= 80
      ? "Send listing options / schedule a showing"
      : lead.stage === "QUALIFIED"
        ? "Contact lead and lock in a showing"
        : "Contact lead";

  const reasoning = [
    `${name} is a ${lead.intentType.toLowerCase()} lead from ${lead.source.replaceAll("_", " ").toLowerCase()}.`,
    lead.preferredArea ? `Preference is ${lead.preferredArea}.` : "No area preference stored.",
    lead.budgetMin || lead.budgetMax
      ? `Budget band ${formatMoney(lead.budgetMin ? Number(lead.budgetMin) : null)} – ${formatMoney(lead.budgetMax ? Number(lead.budgetMax) : null)}.`
      : "Budget is not fully qualified.",
    best ? `Best inventory match is ${best.matchScore}% (${best.property.title}).` : "No strong inventory match yet.",
    opp ? `Open opportunity: ${opp.name} in ${opp.stage.name}.` : "No opportunity opened yet.",
    inbound.length ? "Message history shows an active two-way conversation." : "Conversation history is thin.",
  ].join(" ");

  return parseAiOutput(leadAnalysisSchema, {
    fitScore: lead.fitScore || (best ? Math.min(94, best.matchScore) : 48),
    intentScore: lead.intentScore || (hasVisit ? 82 : lead.stage === "QUALIFIED" ? 72 : 46),
    valueScore: lead.valueScore || 70,
    confidence: Math.min(94, 52 + ctx.activities.length * 3 + inbound.length * 4 + (best ? 8 : 0)),
    niche,
    likelyNeed,
    painPoints: painPoints.slice(0, 5),
    recommendedAction,
    reasoning,
  });
}

export async function analyzeLead(input: {
  workspaceId: string;
  leadId: string;
  actorId?: string | null;
}) {
  const ctx = await measureExecution("ai.inputPrep", () =>
    loadLeadContext(input.workspaceId, input.leadId),
  );
  if (!ctx) return null;

  // Every lead goes through the same derivation. A previous build short-circuited one
  // hardcoded demo lead id to a canned analysis; that made the demo look better than the
  // product was and is removed (see "no fake functionality").
  const output = await measureExecution("ai.analysis", async () => analysisFromContext(ctx));

  const run = await measureExecution("ai.persist", () =>
    storeIntelligenceRun({
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      kind: "LEAD_ANALYSIS",
      entityType: "Lead",
      entityId: ctx.lead.id,
      leadId: ctx.lead.id,
      inputSnapshot: {
        stage: ctx.lead.stage,
        source: ctx.lead.source,
        area: ctx.lead.preferredArea,
        budgetMax: ctx.lead.budgetMax?.toString() ?? null,
      },
      output,
      confidence: output.confidence,
    }),
  );

  return { run, output, lead: ctx.lead };
}
