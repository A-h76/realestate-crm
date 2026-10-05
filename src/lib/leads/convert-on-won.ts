import type { Prisma, PropertyStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";

type Tx = Prisma.TransactionClient;

/**
 * DATA-003 lifecycle (a property is sold/rented by at most one active Won opportunity):
 *  - open/lost -> Won: rejected (409) if another active opportunity already won the property;
 *    otherwise Property.status becomes SOLD (purpose SALE) or RENTED (purpose RENT).
 *  - Won -> open/lost, soft-delete of a Won opportunity, or moving it to another property:
 *    the property returns to AVAILABLE only if it is SOLD/RENTED and no other active Won
 *    opportunity still holds it. RESERVED/WITHDRAWN set by hand are never overridden.
 *  - Any other transition never touches the property.
 * Locks are FOR NO KEY UPDATE (not FOR UPDATE) so they never conflict with the FK share-locks that concurrent activity/task inserts hold, which deadlocked under load. Callers hold the row locks below inside one transaction, so two concurrent stage changes on
 * the same property serialize instead of racing.
 */
export async function lockOpportunity(tx: Tx, workspaceId: string, opportunityId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Opportunity" WHERE id = ${opportunityId} AND "workspaceId" = ${workspaceId} FOR NO KEY UPDATE`;
}

/** Lock property rows in id order (stable order -> no deadlock when two are needed). */
export async function lockProperties(tx: Tx, workspaceId: string, propertyIds: Array<string | null | undefined>): Promise<void> {
  const ids = [...new Set(propertyIds.filter((id): id is string => Boolean(id)))].sort();
  for (const id of ids) {
    await tx.$queryRaw`SELECT id FROM "Property" WHERE id = ${id} AND "workspaceId" = ${workspaceId} FOR NO KEY UPDATE`;
  }
}

function findOtherWonOpportunity(tx: Tx, workspaceId: string, propertyId: string, excludeOpportunityId: string | null) {
  return tx.opportunity.findFirst({
    where: {
      workspaceId,
      linkedPropertyId: propertyId,
      deletedAt: null,
      stage: { isWon: true },
      ...(excludeOpportunityId ? { id: { not: excludeOpportunityId } } : {}),
    },
    select: { id: true },
  });
}

/** Call (with the property locked) before an opportunity becomes Won on `propertyId`. */
export async function assertPropertyNotAlreadyWon(
  tx: Tx,
  workspaceId: string,
  propertyId: string,
  opportunityId: string | null,
): Promise<void> {
  if (await findOtherWonOpportunity(tx, workspaceId, propertyId, opportunityId)) {
    throw new ApiError(409, "This property is already sold or rented through another won opportunity");
  }
}

/** Recompute Property.status from the active Won opportunities that hold it. Call with the property locked. */
export async function reconcilePropertyStatus(
  tx: Tx,
  input: { workspaceId: string; actorId: string | null; propertyId: string; opportunityId: string },
): Promise<void> {
  const property = await tx.property.findFirst({
    where: { id: input.propertyId, workspaceId: input.workspaceId, deletedAt: null },
    select: { id: true, status: true, purpose: true },
  });
  if (!property) return;

  const held = await findOtherWonOpportunity(tx, input.workspaceId, property.id, null);
  let nextStatus: PropertyStatus = property.status;
  if (held) nextStatus = property.purpose === "RENT" ? "RENTED" : "SOLD";
  else if (property.status === "SOLD" || property.status === "RENTED") nextStatus = "AVAILABLE";
  if (nextStatus === property.status) return;

  await tx.property.updateMany({ where: { id: property.id, workspaceId: input.workspaceId }, data: { status: nextStatus } });
  await writeAudit(
    {
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      action: "PROPERTY_STATUS_CHANGED",
      entity: "Property",
      entityId: property.id,
      metadata: { from: property.status, to: nextStatus, reason: "opportunity_stage_change", opportunityId: input.opportunityId },
    },
    tx,
  );
}

/**
 * The one authoritative place a Lead becomes CONVERTED: when the Opportunity
 * it's linked to reaches a Won pipeline stage. LeadStage.CONVERTED already
 * existed and was already relied on elsewhere (scoring, dashboard, insights,
 * the leads table stage filter) — nothing ever actually set it. Reuses the
 * existing field/enum, no new record type. Idempotent: a no-op once the
 * lead is already CONVERTED, so a rename or repeated PATCH to the same Won
 * stage never re-fires the audit trail.
 */
export async function convertLeadOnOpportunityWon(
  input: {
    workspaceId: string;
    actorId: string | null;
    leadId: string;
    opportunityId: string;
  },
  db: Tx = prisma,
): Promise<boolean> {
  // DATA-005: lock the lead row, then read-check-write. Concurrent or repeated conversions queue on
  // the lock, so exactly one performs the transition and writes the audit row; the rest return false.
  const run = async (tx: Tx) => {
    await tx.$queryRaw`SELECT id FROM "Lead" WHERE id = ${input.leadId} AND "workspaceId" = ${input.workspaceId} FOR NO KEY UPDATE`;
    const lead = await tx.lead.findFirst({
      where: { id: input.leadId, workspaceId: input.workspaceId, deletedAt: null },
      select: { stage: true },
    });
    if (!lead || lead.stage === "CONVERTED") return false;

    await tx.lead.updateMany({
      where: { id: input.leadId, workspaceId: input.workspaceId, deletedAt: null },
      data: { stage: "CONVERTED" },
    });
    await writeAudit(
      {
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        action: "LEAD_STAGE_CHANGED",
        entity: "Lead",
        entityId: input.leadId,
        metadata: { from: lead.stage, to: "CONVERTED", reason: "opportunity_won", opportunityId: input.opportunityId },
      },
      tx,
    );
    return true;
  };
  // Called inside the stage-change transaction (db is a tx) or standalone (own transaction).
  return "$transaction" in db ? (db as typeof prisma).$transaction(run) : run(db);
}
