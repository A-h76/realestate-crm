import { formatCurrency } from "@/lib/format";
import { prisma } from "@/lib/db";
import { parseAiOutput, lostDealAnalysisSchema } from "./schemas";
import { storeIntelligenceRun } from "./store";

export async function analyzeLostDeal(input: {
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
      activities: { orderBy: { date: "desc" }, take: 12 },
      proposals: { where: { deletedAt: null } },
    },
  });
  if (!opp) return null;

  const daysOpen = Math.floor((Date.now() - opp.createdAt.getTime()) / 86400000);
  const lastAct = opp.activities[0];
  const output = parseAiOutput(lostDealAnalysisSchema, {
    likelyReason: opp.lostReason || (opp.stage.isLost ? "Marked lost without a captured reason" : "Opportunity is not in a lost stage"),
    contributingFactors: [
      lastAct ? `Last activity: ${lastAct.title ?? lastAct.type}` : "Sparse activity history",
      opp.proposals.length === 0 ? "No proposal on file" : `${opp.proposals.length} proposal(s) issued`,
      `${daysOpen} days open`,
      opp.linkedProperty ? `Property: ${opp.linkedProperty.title}` : "No linked property",
    ],
    recoverable: !opp.stage.isLost || /price|timing|follow/i.test(opp.lostReason ?? ""),
    recommendedRecovery: opp.lead
      ? `Re-engage ${opp.lead.firstName} on WhatsApp with a tighter inventory brief.`
      : "Archive unless a new matching listing appears.",
    lessons: [
      "Capture lost reason at stage change.",
      "Do not leave high-value deals idle past 14 days.",
    ],
  });

  const run = await storeIntelligenceRun({
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    kind: "LOST_DEAL_ANALYSIS",
    entityType: "Opportunity",
    entityId: opp.id,
    leadId: opp.leadId,
    opportunityId: opp.id,
    output,
    confidence: 70,
  });

  return { run, output };
}

export function lostDealValueHint(value: { toString(): string } | number) {
  return formatCurrency(typeof value === "number" ? value : Number(value));
}
