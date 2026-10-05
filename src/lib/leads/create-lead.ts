import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { runAutomations } from "@/lib/automation/engine";
import { ApiError } from "@/lib/errors";
import { assignLeastLoadedAgent } from "@/lib/assignment/assign-lead";
import { canonicalPhone, findDuplicateLead, identityKeys, lockLeadIdentities } from "@/lib/leads/identity";
import type { LeadCreateInput } from "@/lib/validations/leads";

/**
 * Stored phones use the canonical E.164 form when the number is complete and valid; anything
 * else is kept as typed (trimmed) so a partial number entered by a user is not destroyed. A
 * value that does not canonicalize produces no identity key, so it can never false-match.
 */
export function storedPhone(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  return canonicalPhone(value) ?? (value.trim() || null);
}

/** Insert + audit inside the caller's transaction. No duplicate check: callers decide (see createLead). */
export async function createLeadRecord(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  actorId: string | null,
  body: LeadCreateInput,
) {
  // Every lead leaves intake owned: an explicit owner, else the acting user, else (system intake such as a
  // WhatsApp webhook has no actor) the least-loaded agent. null only when the workspace has no agents,
  // which the Needs Attention "unassigned" rule then surfaces.
  let ownerId = body.ownerId ?? actorId;
  let autoAssigned = false;
  if (!ownerId) {
    ownerId = (await assignLeastLoadedAgent(workspaceId, tx))?.agentId ?? null;
    autoAssigned = ownerId !== null;
  }

  const lead = await tx.lead.create({
    data: {
      workspaceId,
      firstName: body.firstName,
      lastName: body.lastName,
      company: body.company,
      email: body.email || null,
      phone: storedPhone(body.phone),
      whatsappNumber: storedPhone(body.whatsappNumber),
      website: body.website,
      industry: body.industry,
      companySize: body.companySize,
      source: body.source,
      notes: body.notes,
      estimatedValue: body.estimatedValue,
      currency: body.currency,
      ownerId,
      assignedAt: ownerId ? new Date() : null,
      stage: body.stage,
      accountId: body.accountId,
      contactId: body.contactId,
      intentType: body.intentType,
      preferredArea: body.preferredArea,
      budgetMin: body.budgetMin,
      budgetMax: body.budgetMax,
      propertyPurpose: body.propertyPurpose,
      propertyTypePref: body.propertyTypePref,
      sizePrefMin: body.sizePrefMin,
      sizePrefMax: body.sizePrefMax,
      sizeUnitPref: body.sizeUnitPref,
      bedroomPref: body.bedroomPref,
      timeline: body.timeline,
      followUpDue: body.followUpDue,
      nextAction: body.nextAction,
    },
  });

  await writeAudit(
    {
      workspaceId,
      actorId,
      action: "LEAD_CREATED",
      entity: "Lead",
      entityId: lead.id,
      metadata: {
        stage: lead.stage,
        source: lead.source,
        ...(autoAssigned ? { assignmentStrategy: "least_loaded", reason: "intake_auto_assign" } : {}),
      },
    },
    tx,
  );
  return lead;
}

/** Once per lead, ever: the key makes a replayed or concurrent trigger a no-op for CREATE_TASK / NOTIFY actions. */
export function runLeadCreatedAutomations(workspaceId: string, actorId: string | null, leadId: string) {
  return runAutomations({
    workspaceId,
    actorId,
    trigger: "LEAD_CREATED",
    leadId,
    eventKey: `lead-created:${leadId}`,
  });
}

/**
 * Real lead-creation path for POST /api/leads and the demo inbound simulator.
 * Refuses (409 + the existing lead's id) when a lead in the workspace already has the same
 * complete phone number or e-mail (rules: src/lib/leads/identity.ts), unless the caller passes
 * `allowDuplicate`. Check-and-insert run under per-identity advisory locks, so two simultaneous
 * submissions cannot both pass the check.
 */
export async function createLead(
  workspaceId: string,
  actorId: string | null,
  body: LeadCreateInput,
  options: { allowDuplicate?: boolean } = {},
) {
  const identity = { phone: body.phone, whatsappNumber: body.whatsappNumber, email: body.email };
  const lead = await prisma.$transaction(async (tx) => {
    if (!options.allowDuplicate) {
      await lockLeadIdentities(tx, workspaceId, identityKeys(identity));
      const duplicate = await findDuplicateLead(tx, workspaceId, identity);
      if (duplicate) {
        throw new ApiError(409, "A lead with the same phone number or email already exists", undefined, {
          duplicateOf: { id: duplicate.id, name: `${duplicate.firstName} ${duplicate.lastName ?? ""}`.trim() },
        });
      }
    }
    return createLeadRecord(tx, workspaceId, actorId, body);
  });

  await runLeadCreatedAutomations(workspaceId, actorId, lead.id);
  return lead;
}
