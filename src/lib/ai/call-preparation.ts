import { formatCurrency, formatDateTimePK } from "@/lib/format";
import { filterAndScoreProperties } from "@/lib/matching/properties";
import { loadLeadContext, leadDisplayName, type LeadContext } from "./context";
import { callPreparationSchema, parseAiOutput, type CallPreparation } from "./schemas";
import { storeIntelligenceRun } from "./store";

function groundedPrep(ctx: LeadContext): CallPreparation {
  const lead = ctx.lead;
  const name = leadDisplayName(lead);
  const matches = filterAndScoreProperties(lead, ctx.properties).slice(0, 3);
  const opp = ctx.opportunities[0];
  const lastWa = ctx.whatsapp.slice(-4).map((m) => `${m.direction}: ${m.body}`);
  const recent = ctx.activities.slice(0, 6).map(
    (a) => `${formatDateTimePK(a.date)} · ${a.title ?? a.type.replaceAll("_", " ")}`,
  );

  return parseAiOutput(callPreparationSchema, {
    leadSummary: `${name} · ${lead.stage} · ${lead.intentType} · ${lead.source.replaceAll("_", " ")}. ${lead.notes ?? ""}`.trim(),
    buyerSellerContext: `${lead.intentType} looking in ${lead.preferredArea ?? "unspecified area"} with budget ${formatCurrency(lead.budgetMin ? Number(lead.budgetMin) : null)} – ${formatCurrency(lead.budgetMax ? Number(lead.budgetMax) : null)}. ${opp ? `Opportunity ${opp.name} is in ${opp.stage.name} at ${formatCurrency(Number(opp.value))}.` : "No opportunity opened."}`,
    previousInteractions: recent.length ? recent : ["No logged interactions yet."],
    whatsappSummary: lastWa.length
      ? lastWa.join(" | ")
      : "No WhatsApp history stored for this lead.",
    propertyInformation: matches.length
      ? matches.map((m) => `${m.matchScore}% ${m.property.title} (${m.property.area ?? "—"})`).join("; ")
      : "No available property currently matches the stored brief.",
    knownNeeds: [
      lead.preferredArea ? `Area: ${lead.preferredArea}` : null,
      lead.propertyTypePref ? `Type: ${lead.propertyTypePref}` : null,
      lead.bedroomPref ? `${lead.bedroomPref} beds` : null,
      lead.timeline ? `Timeline ${lead.timeline}` : null,
    ].filter((v): v is string => Boolean(v)),
    painPoints: [
      lead.followUpDue && lead.followUpDue.getTime() < Date.now() ? "Follow-up is overdue" : null,
      !ctx.calendarEvents.some((e) => e.type === "SITE_VISIT") ? "Site visit not scheduled" : null,
      !lead.budgetMax ? "Budget not confirmed" : null,
    ].filter((v): v is string => Boolean(v)),
    questions: [
      "Which of the shortlisted houses should we walk first?",
      "Who else needs to approve the purchase?",
      "Is the timeline still the same?",
      "Any streets or phases inside the area to avoid?",
    ],
    objections: [
      "Price vs. asking — confirm walk-away number from CRM notes only.",
      "Location compromise — only discuss listed preferred area.",
    ],
    recommendedNextStep: ctx.calendarEvents.some((e) => e.type === "SITE_VISIT")
      ? "Confirm attendance and send the shortlist before the visit."
      : "Schedule a site visit against the top match.",
    propertyMatchIds: matches.map((m) => m.property.id),
  });
}

export async function prepareCall(input: {
  workspaceId: string;
  leadId: string;
  actorId?: string | null;
}) {
  const ctx = await loadLeadContext(input.workspaceId, input.leadId);
  if (!ctx) return null;
  const output = groundedPrep(ctx);
  const run = await storeIntelligenceRun({
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    kind: "CALL_PREPARATION",
    entityType: "Lead",
    entityId: ctx.lead.id,
    leadId: ctx.lead.id,
    output,
    confidence: 82,
  });
  return { run, output };
}
