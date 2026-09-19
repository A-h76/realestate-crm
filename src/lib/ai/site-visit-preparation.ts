import { formatCurrency, formatDateTimePK } from "@/lib/format";
import { filterAndScoreProperties } from "@/lib/matching/properties";
import { loadLeadContext, leadDisplayName } from "./context";
import { parseAiOutput, siteVisitPreparationSchema } from "./schemas";
import { storeIntelligenceRun } from "./store";

export async function prepareSiteVisit(input: {
  workspaceId: string;
  leadId: string;
  actorId?: string | null;
}) {
  const ctx = await loadLeadContext(input.workspaceId, input.leadId);
  if (!ctx) return null;

  const lead = ctx.lead;
  const name = leadDisplayName(lead);
  const matches = filterAndScoreProperties(lead, ctx.properties).slice(0, 3);
  const visit = ctx.calendarEvents.find(
    (e) => e.type === "SITE_VISIT" && e.status === "SCHEDULED",
  );
  const opp = ctx.opportunities[0];

  const output = parseAiOutput(siteVisitPreparationSchema, {
    leadSummary: `${name} · ${lead.intentType} · ${lead.preferredArea ?? "area TBC"} · ${formatCurrency(lead.budgetMax ? Number(lead.budgetMax) : null)} ceiling.`,
    buyerSellerContext: opp
      ? `${opp.dealSide} opportunity ${opp.name} in ${opp.stage.name}.`
      : `${lead.intentType} lead, opportunity not opened.`,
    previousInteractions: ctx.activities.slice(0, 5).map(
      (a) => `${formatDateTimePK(a.date)} · ${a.title ?? a.type}`,
    ),
    whatsappSummary: ctx.whatsapp.length
      ? ctx.whatsapp.slice(-3).map((m) => m.body).join(" / ")
      : "No WhatsApp thread.",
    propertyInformation: visit?.location
      ?? matches[0]?.property.title
      ?? "Property not linked.",
    knownNeeds: [
      lead.bedroomPref ? `${lead.bedroomPref} bedrooms` : null,
      lead.sizePrefMin ? `${lead.sizePrefMin} ${lead.sizeUnitPref ?? ""}`.trim() : null,
      lead.timeline ?? null,
    ].filter((v): v is string => Boolean(v)),
    painPoints: [
      "Confirm access, parking, and who will attend.",
      lead.budgetMax ? "Stay inside the stored budget band." : "Budget still open.",
    ],
    questions: [
      "How does this house compare with the other shortlisted option?",
      "What would block an offer after this visit?",
      "Is financing cash or bank?",
    ],
    objections: ["Fit and finish vs. asking price", "Phase / street preference"],
    recommendedNextStep: "After the visit, log notes and send the proposal or the second option.",
    propertyMatchIds: matches.map((m) => m.property.id),
    visitLogistics: visit
      ? `${visit.title} · ${formatDateTimePK(visit.startAt)} · ${visit.location ?? "location TBC"}`
      : "No site visit is scheduled in the calendar.",
    onSiteTalkingPoints: matches.map(
      (m) => `${m.matchScore}% match · ${m.property.title} · ${m.reasons.map((r) => r.factor).join(", ")}`,
    ),
  });

  const run = await storeIntelligenceRun({
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    kind: "SITE_VISIT_PREPARATION",
    entityType: "Lead",
    entityId: ctx.lead.id,
    leadId: ctx.lead.id,
    opportunityId: opp?.id ?? null,
    output,
    confidence: 84,
  });

  return { run, output };
}
