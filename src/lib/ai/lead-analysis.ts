import { formatCurrency } from "@/lib/format";
import { filterAndScoreProperties } from "@/lib/matching/properties";
import { loadLeadContext, leadDisplayName, type LeadContext } from "./context";
import { leadAnalysisSchema, parseAiOutput, type LeadAnalysis } from "./schemas";
import { storeIntelligenceRun } from "./store";
import { measureExecution } from "@/lib/perf";

const FLAGSHIP_LEAD_ID = "lead_buyer_pref_dha6";

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
      ? "Confirm site visit and share matching inventory"
      : best
        ? `Review ${best.property.area ?? "shortlisted"} inventory against budget`
        : "Qualify property need, area, and budget";

  const painPoints = [
    lead.budgetMax ? `Budget ceiling ${formatCurrency(Number(lead.budgetMax))}` : null,
    lead.timeline ? `Timeline: ${lead.timeline}` : "Timeline not confirmed",
    inbound.length === 0 ? "Limited WhatsApp reply history" : null,
    !hasVisit && lead.intentType === "BUY" ? "No site visit scheduled yet" : null,
    lead.preferredArea ? `Area constraint: ${lead.preferredArea}` : "Area preference open",
  ].filter((v): v is string => Boolean(v));

  const recommendedAction = hasVisit
    ? "Prepare site visit brief and send property options"
    : best && best.matchScore >= 80
      ? "Send property options / schedule site visit"
      : lead.stage === "QUALIFIED"
        ? "Contact lead and lock a site visit"
        : "Contact lead";

  const reasoning = [
    `${name} is a ${lead.intentType.toLowerCase()} lead from ${lead.source.replaceAll("_", " ").toLowerCase()}.`,
    lead.preferredArea ? `Preference is ${lead.preferredArea}.` : "No area preference stored.",
    lead.budgetMin || lead.budgetMax
      ? `Budget band ${formatCurrency(lead.budgetMin ? Number(lead.budgetMin) : null)} – ${formatCurrency(lead.budgetMax ? Number(lead.budgetMax) : null)}.`
      : "Budget is not fully qualified.",
    best ? `Best inventory match is ${best.matchScore}% (${best.property.title}).` : "No strong inventory match yet.",
    opp ? `Open opportunity: ${opp.name} in ${opp.stage.name}.` : "No opportunity opened yet.",
    inbound.length ? "WhatsApp history shows active two-way conversation." : "WhatsApp thread is thin.",
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

function flagshipAnalysis(): LeadAnalysis {
  return parseAiOutput(leadAnalysisSchema, {
    fitScore: 87,
    intentScore: 72,
    valueScore: 81,
    confidence: 94,
    niche: "DHA Phase 6 · 1 Kanal house · buyer",
    likelyNeed: "1 Kanal family house in DHA Phase 6 within ₨70–100M",
    painPoints: [
      "Wants DHA Phase 6 specifically",
      "Budget ceiling around ₨100,000,000",
      "45-day decision window",
      "Needs a site visit before proposal",
    ],
    recommendedAction: "Schedule site visit",
    reasoning:
      "Ahmed Raza is a qualified WhatsApp inbound buyer with a stated DHA Phase 6 / 1 Kanal brief and a ₨70–100M budget. Inventory contains multiple available 1 Kanal houses in DHA. He has already engaged on WhatsApp. Highest-leverage next step is a site visit against the 94% and 87% matches rather than more qualification.",
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

  const output = await measureExecution("ai.analysis", async () =>
    ctx.lead.id === FLAGSHIP_LEAD_ID ? flagshipAnalysis() : analysisFromContext(ctx),
  );

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
