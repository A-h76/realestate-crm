import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { runAutomations } from "@/lib/automation/engine";
import type { LeadCreateInput } from "@/lib/validations/leads";

/**
 * Single real lead-creation path: used by POST /api/leads and by the
 * demo inbound-lead simulator, so simulated leads run through the exact
 * same audit + automation logic as a real one.
 */
export async function createLead(workspaceId: string, actorId: string | null, body: LeadCreateInput) {
  const lead = await prisma.lead.create({
    data: {
      workspaceId,
      firstName: body.firstName,
      lastName: body.lastName,
      company: body.company,
      email: body.email || null,
      phone: body.phone,
      whatsappNumber: body.whatsappNumber,
      website: body.website,
      industry: body.industry,
      companySize: body.companySize,
      source: body.source,
      notes: body.notes,
      estimatedValue: body.estimatedValue,
      currency: body.currency,
      ownerId: body.ownerId ?? actorId,
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

  await writeAudit({
    workspaceId,
    actorId,
    action: "LEAD_CREATED",
    entity: "Lead",
    entityId: lead.id,
    metadata: { stage: lead.stage, source: lead.source },
  });

  await runAutomations({
    workspaceId,
    actorId,
    trigger: "LEAD_CREATED",
    leadId: lead.id,
  });

  return lead;
}
