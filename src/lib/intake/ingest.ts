import type { LeadSource } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/log";
import { alertContacts } from "@/lib/alerts";
import { createLeadRecord, runLeadCreatedAutomations } from "@/lib/leads/create-lead";
import { findDuplicateLead, identityKeys, lockLeadIdentities } from "@/lib/leads/identity";
import { notifyOnce } from "@/lib/notifications";
import { syncRepeatEnquiry } from "@/lib/crm/sync";
import { sendEnquiryAck } from "./ack";

/**
 * The one door for enquiries that arrive without a logged-in person: website forms and Meta lead ads (and, later,
 * inbound email). It reuses the lead path the CRM already has: identity locking, duplicate detection, owner
 * assignment at intake, the LEAD_CREATED audit row, automations, and team alerts.
 *
 * A person who enquires again is NOT turned into a second lead: the new message is attached to their lead as a note,
 * their lead is marked active, and the owner (and alert contacts) are told. Callers get the same answer either way, so a
 * public form never reveals whether an address is already known.
 */
export type Enquiry = {
  name: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  message?: string | null;
  /** Extra answers (service wanted, preferred time...) as label -> value. Kept in the notes until intake answers get their own column. */
  extra?: Record<string, string>;
};

export type IngestResult = { outcome: "created" | "repeat" | "duplicate_event"; leadId: string | null };

const MAX_NOTES = 2000;

function notesFor(sourceName: string, e: Enquiry): string {
  const lines = [`Via ${sourceName}`];
  if (e.message?.trim()) lines.push(e.message.trim());
  for (const [k, v] of Object.entries(e.extra ?? {})) lines.push(`${k}: ${v}`);
  return lines.join("\n").slice(0, MAX_NOTES);
}

export async function ingestEnquiry(input: {
  workspaceId: string;
  source: Extract<LeadSource, "WEB_FORM" | "FACEBOOK_ADS" | "EMAIL">;
  /** Shown on the lead and in the audit trail ("Website form: Contact page"). */
  sourceName: string;
  enquiry: Enquiry;
  /** A provider event claimed in the same transaction as the lead (Meta lead id): a re-delivery then creates nothing. */
  event?: { provider: string; externalEventId: string };
}): Promise<IngestResult> {
  const { workspaceId, source, sourceName, enquiry } = input;
  const email = enquiry.email?.trim().toLowerCase() || null;
  const phone = enquiry.phone?.trim() || null;
  const [firstName, ...rest] = enquiry.name.trim().split(/\s+/);
  const notes = notesFor(sourceName, enquiry);

  const outcome = await prisma.$transaction(async (tx) => {
    await lockLeadIdentities(tx, workspaceId, identityKeys({ phone, email }));

    if (input.event) {
      const claimed = await tx.webhookEvent.createMany({
        // processedAt is set at once: the claim and the lead commit together, so there is nothing for the recovery sweep to re-drive.
        // ponytail: a crash right after commit loses this lead's alert/ack; the custody sweeper still catches the lead by SLA.
        data: [{ provider: input.event.provider, externalEventId: input.event.externalEventId, workspaceId, processedAt: new Date() }],
        skipDuplicates: true,
      });
      if (claimed.count === 0) return { kind: "duplicate_event" as const };
    }

    const known = await findDuplicateLead(tx, workspaceId, { phone, email });
    if (known) {
      const note = await tx.note.create({
        data: { workspaceId, leadId: known.id, body: `Enquired again via ${sourceName}.\n${notes}`.slice(0, MAX_NOTES + 100) },
        select: { id: true },
      });
      await tx.lead.updateMany({ where: { id: known.id, workspaceId }, data: { lastActivityAt: new Date() } });
      const owner = await tx.lead.findUnique({ where: { id: known.id }, select: { ownerId: true } });
      return { kind: "repeat" as const, lead: known, ownerId: owner?.ownerId ?? null, noteId: note.id };
    }

    const lead = await createLeadRecord(
      tx,
      workspaceId,
      null,
      { firstName, lastName: rest.join(" ") || null, company: enquiry.company || null, email, phone, source, notes },
      { intake: sourceName },
    );
    return { kind: "created" as const, lead };
  });

  if (outcome.kind === "duplicate_event") return { outcome: "duplicate_event", leadId: null };

  const name = [outcome.lead.firstName, outcome.lead.lastName].filter(Boolean).join(" ");

  try {
    if (outcome.kind === "repeat") {
      const href = `/leads/${outcome.lead.id}`;
      if (outcome.ownerId) {
        await notifyOnce({
          workspaceId,
          userId: outcome.ownerId,
          type: "ENQUIRY_RECEIVED",
          title: "Customer enquired again",
          body: `${name} sent another enquiry via ${sourceName}.`,
          href,
          entityType: "Lead",
          entityId: outcome.lead.id,
          dedupeKey: `intake-repeat:${outcome.noteId}`,
        });
      }
      await syncRepeatEnquiry(workspaceId, outcome.lead.id, outcome.noteId, notes);
      await alertContacts({ workspaceId, dedupeKey: `intake-repeat:${outcome.noteId}`, subject: `Enquired again: ${name}`, lines: [`${name} sent another enquiry via ${sourceName}.`], href });
      return { outcome: "repeat", leadId: outcome.lead.id };
    }

    const lead = outcome.lead;
    await runLeadCreatedAutomations(workspaceId, null, lead.id); // team alerts + automations
    if (lead.ownerId) {
      await notifyOnce({
        workspaceId,
        userId: lead.ownerId,
        type: "LEAD_ASSIGNED",
        title: "New enquiry assigned to you",
        body: `${name} got in touch via ${sourceName}. Reply within the first few minutes.`,
        href: `/leads/${lead.id}`,
        entityType: "Lead",
        entityId: lead.id,
        dedupeKey: `intake-new:${lead.id}`,
      });
    }
    if (email) await sendEnquiryAck({ workspaceId, leadId: lead.id, email, firstName: lead.firstName });
  } catch (error) {
    // The lead is saved; a failed notification must not turn a good submission into an error for the customer.
    logEvent("error", "intake_post_commit_failed", { workspaceId, leadId: outcome.lead.id, error });
  }
  return { outcome: outcome.kind, leadId: outcome.lead.id };
}
