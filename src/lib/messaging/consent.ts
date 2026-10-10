import type { ConsentStatus, MessagingChannel, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { canonicalPhone } from "@/lib/phone";

/**
 * Consent and suppression, resolved server-side (US-31, US-32).
 *
 * The absence of a record is UNKNOWN, never consent. `MessagingConsent` is keyed on the
 * canonical channel address, so `(415) 555-0123` and `+1 415-555-0123` resolve to the same
 * record and an opt-out cannot be bypassed by re-typing the number differently.
 */

/** Words that, sent on their own, are an opt-out under US carrier/CTIA convention. */
const OPT_OUT_KEYWORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "optout", "opt-out", "revoke"]);
// "yes" is deliberately absent: it answers any question ("want to see it Saturday?"), so treating it as
// opt-in would record messaging consent the customer never gave.
const OPT_IN_KEYWORDS = new Set(["start", "unstop", "optin", "opt-in"]);

/**
 * True when an inbound body is an opt-out. Deliberately strict: only a message whose entire
 * text is the keyword counts, so "stop sending me the Elm St listing, send Oak St instead"
 * is not read as a legal opt-out. Punctuation and case are ignored.
 */
export function isOptOutMessage(body: string | null | undefined): boolean {
  const normalized = body?.trim().toLowerCase().replace(/[.!,;:?'"]/g, "") ?? "";
  return OPT_OUT_KEYWORDS.has(normalized);
}

export function isOptInMessage(body: string | null | undefined): boolean {
  const normalized = body?.trim().toLowerCase().replace(/[.!,;:?'"]/g, "") ?? "";
  return OPT_IN_KEYWORDS.has(normalized);
}

/** Canonical storage key for an address on a channel, or null when it is not usable. */
export function consentAddress(channel: MessagingChannel, raw: string | null | undefined): string | null {
  if (channel === "EMAIL") {
    const value = raw?.trim().toLowerCase();
    return value && value.includes("@") ? value : null;
  }
  return canonicalPhone(raw);
}

export async function getConsentStatus(
  workspaceId: string,
  channel: MessagingChannel,
  rawAddress: string | null | undefined,
): Promise<{ status: ConsentStatus; address: string | null; timezone: string | null }> {
  const address = consentAddress(channel, rawAddress);
  if (!address) return { status: "UNKNOWN", address: null, timezone: null };
  const record = await prisma.messagingConsent.findUnique({
    where: { workspaceId_channel_address: { workspaceId, channel, address } },
    select: { status: true, timezone: true },
  });
  return { status: record?.status ?? "UNKNOWN", address, timezone: record?.timezone ?? null };
}

/**
 * Records a consent decision. REVOKED never silently becomes GRANTED: re-opt-in is allowed,
 * but it must arrive as its own explicit call with its own source and evidence, and the
 * transition is audited either way.
 */
export async function recordConsent(input: {
  workspaceId: string;
  channel: MessagingChannel;
  rawAddress: string | null | undefined;
  status: Exclude<ConsentStatus, "UNKNOWN">;
  source: string;
  evidence?: string | null;
  leadId?: string | null;
  contactId?: string | null;
  actorId?: string | null;
  tx?: Prisma.TransactionClient;
}): Promise<{ recorded: boolean; address: string | null }> {
  const address = consentAddress(input.channel, input.rawAddress);
  if (!address) return { recorded: false, address: null };
  const db = input.tx ?? prisma;

  await db.messagingConsent.upsert({
    where: { workspaceId_channel_address: { workspaceId: input.workspaceId, channel: input.channel, address } },
    create: {
      workspaceId: input.workspaceId,
      channel: input.channel,
      address,
      status: input.status,
      source: input.source,
      evidence: input.evidence ?? null,
      leadId: input.leadId ?? null,
      contactId: input.contactId ?? null,
      revokedAt: input.status === "REVOKED" ? new Date() : null,
    },
    update: {
      status: input.status,
      source: input.source,
      evidence: input.evidence ?? null,
      capturedAt: new Date(),
      revokedAt: input.status === "REVOKED" ? new Date() : null,
    },
  });

  await writeAudit(
    {
      workspaceId: input.workspaceId,
      actorId: input.actorId ?? null,
      action: "CONSENT_RECORDED",
      entity: "MessagingConsent",
      entityId: address,
      metadata: { consent: input.status, channel: input.channel, source: input.source, leadId: input.leadId ?? null },
    },
    input.tx,
  );

  return { recorded: true, address };
}
