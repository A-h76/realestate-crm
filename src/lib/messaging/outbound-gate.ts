import type { MessagingChannel, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { formatInTimeZone } from "date-fns-tz";
import { getConsentStatus } from "./consent";

/**
 * The single server-side authorization point for anything leaving the CRM (US-32, US-33, US-36).
 *
 * Every send — manual, automated or retried — calls `authorizeOutbound` immediately before the
 * provider call, inside the lead-scoped lock below. Nothing here depends on a frontend check:
 * the UI may hide a button, but this is what actually decides.
 *
 * Independent reasons a send is refused:
 *  1. **Control** — a human has taken the conversation over, so AI may not send (`AI` intent only).
 *  2. **Consent** — the recipient is REVOKED (no send at all, ever), or, for MARKETING, is
 *     anything other than explicitly GRANTED. UNKNOWN is never treated as consent for
 *     marketing. Service replies inside a conversation the customer started are solicited by
 *     definition and are not gated on a stored opt-in — only on the absence of an opt-out.
 *  3. **Mode** — the workspace is in DRAFT mode, so AI output is drafted for approval, never sent.
 *  4. **Timing** (AI and MARKETING only) — quiet hours in the recipient's local time, and a
 *     per-recipient cap on automated messages in a rolling window. A HUMAN send is never refused for
 *     timing: a person answering a customer's own message is a service reply (opt-out still wins).
 *
 * Assumption (recipient timezone): `MessagingConsent.timezone` when set, otherwise the WORKSPACE timezone.
 * There is no area-code lookup yet, so a lead in another time zone than the workspace is judged by the
 * workspace clock; the audit row records which source was used. Upgrade: area-code table feeding
 * `MessagingConsent.timezone` at intake.
 */

export type OutboundIntent =
  /** A human composed or explicitly approved this message. */
  | "HUMAN"
  /** The AI conversational engine produced this without a human in the loop. */
  | "AI"
  /** Bulk/marketing content. Always requires explicit GRANTED consent. */
  | "MARKETING";

export type OutboundDecision =
  | { allowed: true }
  | { allowed: false; reason: OutboundBlockReason; message: string; detail?: Record<string, string | number> };

export type OutboundBlockReason =
  | "human_took_over"
  | "ai_mode_draft"
  | "consent_revoked"
  | "consent_not_granted"
  | "no_recipient"
  | "quiet_hours"
  | "frequency_cap";

/** Blocks where the content is fine and only the moment is wrong: the AI path keeps the reply as a draft for a human. */
export const DEFERRABLE_BLOCKS: readonly OutboundBlockReason[] = ["ai_mode_draft", "quiet_hours", "frequency_cap"];

const BLOCK_MESSAGES: Record<OutboundBlockReason, string> = {
  human_took_over: "A team member has taken over this conversation. The assistant will not reply here.",
  ai_mode_draft: "This workspace keeps the assistant in draft mode. The reply was saved for a human to review and send.",
  consent_revoked: "This contact opted out of messages. Sending is blocked.",
  consent_not_granted: "No recorded opt-in for this contact, so marketing messages are blocked.",
  no_recipient: "No usable phone number on file for this recipient.",
  quiet_hours: "It is quiet hours for this recipient, so automated messages are held. A person can still reply.",
  frequency_cap: "This recipient has already received the maximum number of automated messages for now. A person can still reply.",
};

const minuteOfDay = (now: Date, timeZone: string) => {
  const [h, m] = formatInTimeZone(now, timeZone, "H:m").split(":").map(Number);
  return h * 60 + m;
};

/** start > end wraps midnight (21:00-08:00); start === end disables quiet hours. */
export function inQuietHours(minute: number, startMin: number, endMin: number): boolean {
  if (startMin === endMin) return false;
  return startMin < endMin ? minute >= startMin && minute < endMin : minute >= startMin || minute < endMin;
}

const validZone = (tz: string | null | undefined): tz is string => {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/**
 * Advisory lock name for one lead's conversation control. `takeOverLead` takes the same lock,
 * which is what makes takeover and an in-flight AI send mutually exclusive rather than merely
 * sequential: whichever transaction gets the lock first wins, and the loser sees the other's
 * committed state. Without it, the orchestrator's "has a human taken over?" check and its
 * provider call are seconds apart and a takeover landing in between is ignored (US-36).
 */
export function conversationControlLockKey(workspaceId: string, leadId: string): string {
  return `conversation-control:${workspaceId}:${leadId}`;
}

export async function lockConversationControl(
  tx: Pick<Prisma.TransactionClient, "$executeRaw">,
  workspaceId: string,
  leadId: string,
): Promise<void> {
  const name = conversationControlLockKey(workspaceId, leadId);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${name}, 0))`;
}

/** The takeover marker written by `takeOverLead`, read as the authoritative control state. */
export async function hasHumanTakenOver(
  db: Pick<Prisma.TransactionClient, "activity">,
  workspaceId: string,
  leadId: string,
): Promise<boolean> {
  const marker = await db.activity.findFirst({
    where: { workspaceId, leadId, metadata: { path: ["conversationTakeover"], equals: true } },
    select: { id: true },
  });
  return marker != null;
}

/**
 * Decides whether this specific send may proceed, reading current state — not state captured
 * at the start of the turn. Callers must hold the conversation-control lock.
 */
export async function authorizeOutbound(input: {
  workspaceId: string;
  leadId: string | null;
  channel: MessagingChannel;
  intent: OutboundIntent;
  recipientAddress: string | null | undefined;
  /** Test seam; production always uses the real clock. */
  now?: Date;
}): Promise<OutboundDecision> {
  const { workspaceId, leadId, channel, intent } = input;
  const now = input.now ?? new Date();

  if (intent !== "HUMAN" && leadId) {
    if (await hasHumanTakenOver(prisma, workspaceId, leadId)) {
      return blocked("human_took_over");
    }
  }

  if (intent === "AI") {
    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { aiMode: true } });
    // Missing workspace or missing mode falls through to DRAFT: the safe side.
    if ((workspace?.aiMode ?? "DRAFT") !== "AUTO") return blocked("ai_mode_draft");
  }

  const { status, address, timezone } = await getConsentStatus(workspaceId, channel, input.recipientAddress);
  if (!address) return blocked("no_recipient");

  // An opt-out is absolute and applies to every intent, including a human reply.
  if (status === "REVOKED") return blocked("consent_revoked");

  // Only MARKETING requires an affirmative, recorded opt-in. HUMAN and AI sends here are
  // service replies within a conversation the customer initiated (the engine only ever runs
  // on an inbound message), which are solicited — refusing them would make the product
  // unable to answer its own customers. UNKNOWN still blocks marketing, which is the case
  // the "unknown is not consent" rule exists for.
  if (intent === "MARKETING" && status !== "GRANTED") return blocked("consent_not_granted");

  if (intent !== "HUMAN") {
    const ws = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { timezone: true, quietHoursStartMin: true, quietHoursEndMin: true, autoMessageCap: true, autoMessageCapHours: true },
    });
    // A missing workspace cannot happen for a real send; fail closed rather than send untimed.
    if (!ws) return blocked("quiet_hours", { reason: "workspace_missing" });

    const recipientZone = validZone(timezone);
    const zone = recipientZone ? timezone! : ws.timezone;
    const minute = minuteOfDay(now, zone);
    if (inQuietHours(minute, ws.quietHoursStartMin, ws.quietHoursEndMin)) {
      return blocked("quiet_hours", {
        timezone: zone,
        timezoneSource: recipientZone ? "recipient" : "workspace",
        localMinute: minute,
        quietStartMin: ws.quietHoursStartMin,
        quietEndMin: ws.quietHoursEndMin,
      });
    }

    // Automated = no human sender. Drafts and failed sends never reached the customer, so they do not count.
    // ponytail: the lead-scoped lock is released before the provider call, so two sends racing in the same
    // instant can both pass this count; reserve a row inside the lock when volume makes that real.
    if (leadId) {
      const sent = await prisma.whatsAppMessage.count({
        where: {
          workspaceId,
          leadId,
          direction: "OUTBOUND",
          senderId: null,
          status: { notIn: ["DRAFT", "FAILED"] },
          sentAt: { gte: new Date(now.getTime() - ws.autoMessageCapHours * 3_600_000) },
        },
      });
      if (sent >= ws.autoMessageCap) {
        return blocked("frequency_cap", { sent, cap: ws.autoMessageCap, windowHours: ws.autoMessageCapHours });
      }
    }
  }

  return { allowed: true };
}

function blocked(reason: OutboundBlockReason, detail?: Record<string, string | number>): OutboundDecision {
  return { allowed: false, reason, message: BLOCK_MESSAGES[reason], ...(detail ? { detail } : {}) };
}

export function describeOutboundBlock(reason: OutboundBlockReason): string {
  return BLOCK_MESSAGES[reason];
}

/** Records a refusal so a blocked send is visible in the audit history, not silently dropped. */
export async function auditOutboundBlock(input: {
  workspaceId: string;
  leadId: string | null;
  intent: OutboundIntent;
  channel: MessagingChannel;
  reason: OutboundBlockReason;
  /** Why exactly (timezone used, counts), so an operator can see what the gate saw. */
  detail?: Record<string, string | number>;
  actorId?: string | null;
  messageId?: string | null;
}): Promise<void> {
  await writeAudit({
    workspaceId: input.workspaceId,
    actorId: input.actorId ?? null,
    action: "OUTBOUND_BLOCKED",
    entity: "WhatsAppMessage",
    entityId: input.messageId ?? input.leadId ?? "unknown",
    metadata: {
      reason: input.reason,
      intent: input.intent,
      channel: input.channel,
      leadId: input.leadId,
      ...(input.detail ? { detail: input.detail } : {}),
    },
  });
}
