import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

/**
 * The one authoritative place a Lead becomes CONVERTED: when the Opportunity
 * it's linked to reaches a Won pipeline stage. LeadStage.CONVERTED already
 * existed and was already relied on elsewhere (scoring, dashboard, insights,
 * the leads table stage filter) — nothing ever actually set it. Reuses the
 * existing field/enum, no new record type. Idempotent: a no-op once the
 * lead is already CONVERTED, so a rename or repeated PATCH to the same Won
 * stage never re-fires the audit trail.
 */
export async function convertLeadOnOpportunityWon(input: {
  workspaceId: string;
  actorId: string | null;
  leadId: string;
  opportunityId: string;
}): Promise<boolean> {
  const lead = await prisma.lead.findFirst({
    where: { id: input.leadId, workspaceId: input.workspaceId, deletedAt: null },
    select: { stage: true },
  });
  if (!lead || lead.stage === "CONVERTED") return false;

  await prisma.lead.updateMany({
    where: { id: input.leadId, workspaceId: input.workspaceId, deletedAt: null },
    data: { stage: "CONVERTED" },
  });

  await writeAudit({
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    action: "LEAD_STAGE_CHANGED",
    entity: "Lead",
    entityId: input.leadId,
    metadata: { from: lead.stage, to: "CONVERTED", reason: "opportunity_won", opportunityId: input.opportunityId },
  });

  return true;
}
