import { formatCurrency } from "@/lib/format";
import { filterAndScoreProperties } from "@/lib/matching/properties";
import { loadLeadContext } from "./context";
import { parseAiOutput, propertyMatchBundleSchema, type PropertyMatchBundle } from "./schemas";
import { storeIntelligenceRun } from "./store";

export async function explainPropertyMatches(input: {
  workspaceId: string;
  leadId: string;
  actorId?: string | null;
}) {
  const ctx = await loadLeadContext(input.workspaceId, input.leadId);
  if (!ctx) return null;

  const scored = filterAndScoreProperties(ctx.lead, ctx.properties);
  const output: PropertyMatchBundle = parseAiOutput(propertyMatchBundleSchema, {
    matches: scored.map((row) => ({
      propertyId: row.property.id,
      matchScore: row.matchScore,
      why: row.reasons.map((r) => ({ factor: r.factor, detail: r.detail })),
      caution: row.caution,
    })),
    summary: scored[0]
      ? `Top match ${scored[0].matchScore}% · ${scored[0].property.title} · ${formatCurrency(Number(scored[0].property.price))}. Deterministic filter ran before explanation.`
      : "No available properties passed the deterministic filter for this brief.",
  });

  const run = await storeIntelligenceRun({
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    kind: "PROPERTY_MATCH",
    entityType: "Lead",
    entityId: ctx.lead.id,
    leadId: ctx.lead.id,
    output,
    confidence: scored[0]?.matchScore ?? 0,
    status: "PENDING",
  });

  return { run, output, scored };
}
