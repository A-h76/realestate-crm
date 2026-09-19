import { formatCurrency } from "@/lib/format";
import { prisma } from "@/lib/db";
import { parseAiOutput, opportunitySummarySchema } from "./schemas";
import { storeIntelligenceRun } from "./store";

export async function summarizeOpportunity(input: {
  workspaceId: string;
  opportunityId: string;
  actorId?: string | null;
}) {
  const opp = await prisma.opportunity.findFirst({
    where: { id: input.opportunityId, workspaceId: input.workspaceId, deletedAt: null },
    include: {
      stage: true,
      lead: true,
      linkedProperty: true,
      owner: { select: { name: true } },
      tasks: { where: { deletedAt: null, status: { in: ["TODO", "IN_PROGRESS"] } }, take: 5 },
      proposals: { where: { deletedAt: null }, take: 5, orderBy: { updatedAt: "desc" } },
    },
  });
  if (!opp) return null;

  const daysInStage = Math.floor((Date.now() - opp.stageEnteredAt.getTime()) / 86400000);
  const output = parseAiOutput(opportunitySummarySchema, {
    summary: `${opp.name} is a ${opp.dealSide.toLowerCase()} deal in ${opp.stage.name} at ${formatCurrency(Number(opp.value))} (${opp.probability}%). ${opp.linkedProperty ? `Linked: ${opp.linkedProperty.title}.` : "No property linked."} ${opp.lead ? `Lead ${opp.lead.firstName} ${opp.lead.lastName ?? ""}.` : ""}`.trim(),
    valueNarrative: `Gross ${formatCurrency(Number(opp.value))} · weighted ${formatCurrency((Number(opp.value) * opp.probability) / 100)}.`,
    stageRisk: daysInStage >= 14
      ? `Stalled ${daysInStage} days in ${opp.stage.name}.`
      : `${daysInStage} days in ${opp.stage.name}.`,
    recommendedAction: opp.stage.slug === "proposal"
      ? "Follow up on the proposal"
      : opp.stage.slug === "discovery"
        ? "Schedule site visit"
        : opp.stage.isLost
          ? "Capture lost reason"
          : "Advance with a dated next step",
    blockers: [
      opp.tasks.length ? `${opp.tasks.length} open task(s)` : null,
      !opp.linkedProperty ? "No linked property" : null,
      daysInStage >= 14 ? "Stage aging past 14 days" : null,
    ].filter((v): v is string => Boolean(v)),
  });

  const run = await storeIntelligenceRun({
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    kind: "OPPORTUNITY_SUMMARY",
    entityType: "Opportunity",
    entityId: opp.id,
    leadId: opp.leadId,
    opportunityId: opp.id,
    output,
    confidence: 78,
  });

  return { run, output, opportunity: opp };
}
