import type { ActorType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

/** Activity types that count as real outreach to the lead (when COMPLETED). Shared with the Needs Attention rules. */
export const CONTACT_ACTIVITY_TYPES = ["CALL", "EMAIL", "MEETING", "WHATSAPP_MESSAGE", "SITE_VISIT"] as const;

/**
 * Records the first real outreach to a lead, exactly once. The conditional update (firstContactAt IS NULL) makes
 * concurrent or repeated calls safe: only the caller that wins writes the timestamp and the audit event, so
 * response-time measurement is never overwritten by a later touch. Drafts and failed sends are not contact.
 */
export async function markFirstContact(input: {
  workspaceId: string;
  leadId: string;
  at?: Date;
  actorId?: string | null;
  actorType: ActorType;
  via: string;
}): Promise<boolean> {
  const at = input.at ?? new Date();
  const won = await prisma.lead.updateMany({
    where: { id: input.leadId, workspaceId: input.workspaceId, deletedAt: null, firstContactAt: null },
    data: { firstContactAt: at },
  });
  if (won.count === 0) return false;
  const lead = await prisma.lead.findUnique({ where: { id: input.leadId }, select: { createdAt: true } });
  await writeAudit({
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    actorType: input.actorType,
    action: "LEAD_FIRST_CONTACT",
    entity: "Lead",
    entityId: input.leadId,
    occurredAt: at,
    metadata: { via: input.via, msFromCreated: lead ? at.getTime() - lead.createdAt.getTime() : null },
  });
  return true;
}
