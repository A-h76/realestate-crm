import { formatCurrency } from "@/lib/format";
import { prisma } from "@/lib/db";
import { parseAiOutput, proposalSummarySchema } from "./schemas";
import { storeIntelligenceRun } from "./store";

export async function summarizeProposal(input: {
  workspaceId: string;
  proposalId: string;
  actorId?: string | null;
}) {
  const proposal = await prisma.proposal.findFirst({
    where: { id: input.proposalId, workspaceId: input.workspaceId, deletedAt: null },
    include: {
      lead: true,
      opportunity: { include: { stage: true } },
      linkedProperty: true,
    },
  });
  if (!proposal) return null;

  const output = parseAiOutput(proposalSummarySchema, {
    summary: `${proposal.proposalNumber} is ${proposal.status.toLowerCase()} at ${formatCurrency(Number(proposal.value))}${proposal.linkedProperty ? ` for ${proposal.linkedProperty.title}` : ""}. Viewed ${proposal.viewCount} time(s).`,
    highlights: [
      proposal.opportunity ? `Opportunity: ${proposal.opportunity.name}` : "No opportunity linked",
      proposal.lead ? `Lead: ${proposal.lead.firstName}` : "No lead linked",
      proposal.viewCount > 0 ? `${proposal.viewCount} views` : "Not viewed yet",
    ],
    followUp:
      proposal.status === "VIEWED"
        ? "Call while the proposal is warm."
        : proposal.status === "SENT"
          ? "Confirm receipt on WhatsApp."
          : "Send the proposal after a site visit.",
  });

  const run = await storeIntelligenceRun({
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    kind: "PROPOSAL_SUMMARY",
    entityType: "Proposal",
    entityId: proposal.id,
    leadId: proposal.leadId,
    opportunityId: proposal.opportunityId,
    output,
    confidence: 76,
  });

  return { run, output };
}
