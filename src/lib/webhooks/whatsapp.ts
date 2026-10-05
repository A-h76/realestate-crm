import { Prisma, type WhatsAppMessageStatus } from "@prisma/client";
import { ApiError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { notifyOnce } from "@/lib/notifications";
import { writeAudit } from "@/lib/audit";
import { consentAddress, isOptInMessage, isOptOutMessage, recordConsent } from "@/lib/messaging/consent";
import { verifyHubSignature256 } from "@/lib/security/hmac";
import { measureExecution } from "@/lib/perf";
import { createLeadRecord, runLeadCreatedAutomations } from "@/lib/leads/create-lead";
import { canonicalPhone, duplicateWhere, lockLeadIdentities } from "@/lib/leads/identity";
import {
  applyRequirementUpdate,
  extractRequirement,
  type RequirementSnapshot,
} from "@/lib/whatsapp/extract-requirement";
import { detectHandoff } from "@/lib/whatsapp/detect-handoff";
import { triggerHandoff } from "@/lib/whatsapp/handoff-event";
import { runConversationTurn } from "@/lib/whatsapp/conversation-orchestrator";

type CloudMessage = {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
};

type CloudPayload = {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        messaging_product?: string;
        metadata?: { phone_number_id?: string; display_phone_number?: string };
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
        messages?: CloudMessage[];
        statuses?: Array<{ id?: string; status?: string }>;
      };
    }>;
  }>;
};

export type WebhookProcessResult = {
  status: "stored" | "duplicate" | "ignored" | "accepted";
  stored: number;
  duplicates: number;
};

async function resolveWorkspaceId(phoneNumberId: string): Promise<string | null> {
  const integration = await prisma.whatsAppIntegration.findFirst({
    where: { phoneNumberId, enabled: true },
    select: { workspaceId: true },
  });
  if (integration) return integration.workspaceId;

  const envPhone = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const envWorkspace = process.env.WHATSAPP_WORKSPACE_ID;
  if (envPhone && envWorkspace && envPhone === phoneNumberId) {
    const workspace = await prisma.workspace.findFirst({
      where: { id: envWorkspace, deletedAt: null },
      select: { id: true },
    });
    return workspace?.id ?? null;
  }
  return null;
}

const META_STATUS_MAP: Record<string, WhatsAppMessageStatus> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
};

/**
 * Statuses a message may move FROM, per target. Meta delivers status callbacks out of order and more than once, so a
 * late "delivered" must not overwrite "read", and a replayed "sent" must not undo "delivered". Only forward moves apply;
 * "failed" applies only to a message that is not yet delivered.
 */
const STATUS_MOVES_FROM: Record<WhatsAppMessageStatus, WhatsAppMessageStatus[]> = {
  DRAFT: [],
  QUEUED: [],
  SENT: ["QUEUED"],
  DELIVERED: ["QUEUED", "SENT"],
  READ: ["QUEUED", "SENT", "DELIVERED"],
  FAILED: ["QUEUED", "SENT"],
};

/** Meta delivery-status webhook (sent/delivered/read/failed) for an outbound message we sent. */
async function applyStatusUpdate(workspaceId: string, status: { id?: string; status?: string }) {
  if (!status.id || !status.status) return;
  const mapped = META_STATUS_MAP[status.status];
  if (!mapped) return;
  await measureExecution("webhook.status", () =>
    prisma.whatsAppMessage.updateMany({
      where: {
        workspaceId,
        provider: "whatsapp-business",
        externalId: status.id,
        direction: "OUTBOUND",
        status: { in: STATUS_MOVES_FROM[mapped] },
      },
      data: { status: mapped },
    }),
  );
}

/**
 * Everything the Meta webhook does for one inbound text after signature
 * verification: lead create/update, requirement extraction, handoff
 * detection, and the automatic conversation turn. Exported so the demo
 * seed (prisma/seed-ux-audit.ts) exercises the real inbound path.
 */
export async function storeInboundMessage(input: {
  workspaceId: string;
  phone: string;
  body: string;
  externalId: string;
  profileName: string | null;
  /** false for non-text message types: skip requirement extraction and handoff detection on the placeholder body. */
  extractable: boolean;
  metadata?: Record<string, unknown>;
  /**
   * Demo-only (INTG-011): runs the same lead/extraction/handoff/conversation path for a simulated customer message.
   * Rows are tagged provider "demo", the event is claimed under a separate provider key so it can never collide with
   * a real Meta event id, and the audit row records the acting user. The caller must have verified Demo Mode and
   * that the active WhatsApp provider is the demo one (so the automatic reply cannot reach a real customer).
   */
  simulation?: { actorId: string };
}): Promise<"created" | "duplicate"> {
  const sim = input.simulation;
  const extracted = input.extractable ? extractRequirement(input.body) : {};
  const canonical = canonicalPhone(input.phone);
  const [firstName, ...rest] = (input.profileName?.trim() || `WhatsApp Lead ${input.phone.slice(-4)}`).split(/\s+/);

  /**
   * DATA-001/002: one transaction does, in order, (1) take the per-phone lock, (2) claim the webhook
   * event, (3) find-or-create the lead, (4) store the message. Concurrent deliveries for the same
   * number queue on the lock, so exactly one creates the lead and the rest attach to it; a replayed
   * event is rejected at step 2 *before* any lead is created (previously a concurrent replay could
   * leave an orphan duplicate lead behind).
   */
  const persisted = await measureExecution("webhook.persist", () =>
    prisma.$transaction(async (tx) => {
      await lockLeadIdentities(tx, input.workspaceId, [`p:${canonical ?? input.phone}`]);

      const claimed = await tx.webhookEvent.createMany({
        data: [{ provider: sim ? "whatsapp-simulated" : "whatsapp", externalEventId: input.externalId, workspaceId: input.workspaceId }],
        skipDuplicates: true,
      });
      if (claimed.count === 0) return null;

      const phoneWhere = canonical
        ? duplicateWhere(input.workspaceId, { phone: canonical })!
        : { workspaceId: input.workspaceId, deletedAt: null, OR: [{ whatsappNumber: input.phone }, { phone: input.phone }] };
      const existingLead = await tx.lead.findFirst({
        where: phoneWhere,
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          ownerId: true,
          propertyPurpose: true,
          propertyTypePref: true,
          intentType: true,
          preferredArea: true,
          budgetMin: true,
          budgetMax: true,
          sizePrefMin: true,
          sizePrefMax: true,
          sizeUnitPref: true,
          bedroomPref: true,
        },
      });
      const contact = await tx.contact.findFirst({
        where: {
          workspaceId: input.workspaceId,
          deletedAt: null,
          OR: [{ whatsappNumber: input.phone }, { phone: input.phone }],
        },
        select: { id: true },
      });

      let lead: { id: string; ownerId: string | null };
      let isNewLead = false;
      let previousMessage: string | null = null;
      if (existingLead) {
        lead = existingLead;
        previousMessage =
          (
            await tx.whatsAppMessage.findFirst({
              where: { workspaceId: input.workspaceId, leadId: existingLead.id, direction: "INBOUND" },
              orderBy: { sentAt: "desc" },
              select: { body: true },
            })
          )?.body ?? null;
      } else {
        lead = await createLeadRecord(tx, input.workspaceId, null, {
          firstName,
          lastName: rest.join(" ") || null,
          phone: input.phone,
          whatsappNumber: input.phone,
          source: "WHATSAPP_INBOUND",
          ...extracted,
        });
        isNewLead = true;
      }

      const row = await tx.whatsAppMessage.create({
        data: {
          workspaceId: input.workspaceId,
          conversationId: `lead:${lead.id}`,
          direction: "INBOUND",
          body: input.body,
          status: "DELIVERED",
          leadId: lead.id,
          contactId: contact?.id,
          provider: sim ? "demo" : "whatsapp-business",
          externalId: input.externalId,
          metadata: sim
            ? { simulated: true, demoNotice: "Simulated inbound Demo WhatsApp message.", ...input.metadata }
            : { webhook: true, ...input.metadata },
        },
        select: { id: true },
      });
      // A customer message is real activity: without this the inactive-lead sweep can flag a lead who just wrote in.
      await tx.lead.updateMany({ where: { id: lead.id, workspaceId: input.workspaceId }, data: { lastActivityAt: new Date() } });
      return { lead, existingLead, isNewLead, previousMessage, rowId: row.id };
    }),
  ).catch((error: unknown) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return null;
    throw error;
  });

  if (!persisted) return "duplicate";
  const { lead, existingLead, isNewLead, previousMessage, rowId } = persisted;

  await runPostCommitSteps({
    workspaceId: input.workspaceId,
    leadId: lead.id,
    ownerId: lead.ownerId,
    phone: input.phone,
    body: input.body,
    rowId,
    extractable: input.extractable,
    extracted,
    isNewLead,
    existingLead: existingLead as unknown as RequirementSnapshot | null,
    previousMessage,
    sim,
    redrive: false,
  });
  await markEventProcessed(sim ? "whatsapp-simulated" : "whatsapp", input.externalId);
  return "created";
}

type PostCommitContext = {
  workspaceId: string;
  leadId: string;
  ownerId: string | null;
  phone: string;
  body: string;
  rowId: string;
  extractable: boolean;
  extracted: ReturnType<typeof extractRequirement>;
  isNewLead: boolean;
  existingLead: RequirementSnapshot | null;
  previousMessage: string | null;
  sim?: { actorId: string };
  /** true when the recovery sweep replays a turn the first attempt did not finish: every step must tolerate having already run. */
  redrive: boolean;
};

/**
 * Everything that follows the claim+message commit. Each step is safe to run twice, because the recovery sweep replays
 * the whole sequence for an event whose first attempt died part-way (see recoverStalledWebhookEvents).
 */
async function runPostCommitSteps(c: PostCommitContext): Promise<void> {
  const { workspaceId, leadId, rowId, sim } = c;
  const conversationId = `lead:${leadId}`;

  if (c.isNewLead) {
    await runLeadCreatedAutomations(workspaceId, null, leadId); // eventKey makes a replay a no-op
  } else if (c.existingLead) {
    await applyRequirementUpdate(workspaceId, leadId, c.existingLead, c.extracted); // fills blanks only
  }

  const alreadyLogged =
    c.redrive && (await prisma.auditLog.count({ where: { workspaceId, action: "WHATSAPP_MESSAGE_LOGGED", entityId: rowId } })) > 0;
  if (!alreadyLogged) {
    await writeAudit({
      workspaceId,
      actorId: sim?.actorId,
      actorType: sim ? "USER" : "CUSTOMER",
      providerEventId: sim ? undefined : await providerEventIdOf(rowId),
      action: "WHATSAPP_MESSAGE_LOGGED",
      entity: "WhatsAppMessage",
      entityId: rowId,
      metadata: sim ? { direction: "INBOUND", demo: true, simulated: true } : { direction: "INBOUND", webhook: true },
    });
  }

  if (c.ownerId) {
    await measureExecution("webhook.notify", () =>
      notifyOnce({
        workspaceId,
        userId: c.ownerId!,
        type: "WHATSAPP_RECEIVED",
        title: "WhatsApp message received",
        body: "New inbound WhatsApp message",
        href: `/leads/${leadId}`,
        entityType: "Lead",
        entityId: leadId,
        dedupeKey: `inbound:${rowId}`,
      }),
    );
  }

  // An opt-out is honored before anything else can reply (US-32). It is recorded against the
  // canonical number, so the suppression holds however the number is spelled later, and the
  // conversational engine is not run at all for this message — replying "you're unsubscribed"
  // would itself be a message to someone who just asked us to stop.
  if (isOptOutMessage(c.body)) {
    if (!(await consentSupersedes(c, rowId))) {
      await recordConsent({
        workspaceId,
        channel: "WHATSAPP",
        rawAddress: c.phone,
        status: "REVOKED",
        source: "inbound_stop",
        evidence: `whatsapp message ${rowId}`,
        leadId,
        actorId: sim?.actorId ?? null,
      });
    }
    return;
  }

  // An explicit opt-in keyword from the customer is recorded as consent with the message as
  // its evidence; the turn then continues normally.
  if (isOptInMessage(c.body) && !(await consentSupersedes(c, rowId))) {
    await recordConsent({
      workspaceId,
      channel: "WHATSAPP",
      rawAddress: c.phone,
      status: "GRANTED",
      source: "inbound_optin_keyword",
      evidence: `whatsapp message ${rowId}`,
      leadId,
      actorId: sim?.actorId ?? null,
    });
  }

  if (!c.extractable) return;
  const detection = detectHandoff(c.body, { previousMessage: c.previousMessage });
  if (detection.shouldHandoff) {
    await measureExecution("webhook.handoff", () =>
      triggerHandoff({ workspaceId, leadId, detection, triggerMessage: c.body, triggerMessageId: rowId }),
    );
    return;
  }
  // Only a non-handoff customer message ever reaches the automatic conversational reply — never re-entered by our own
  // outbound sends or by Meta status callbacks, which are handled separately above. A replay must not answer twice:
  // any outbound after this inbound (sent, queued or saved draft) means the turn already ran.
  if (c.redrive && (await outboundFollowsInbound(workspaceId, conversationId, rowId))) return;
  await measureExecution("webhook.conversation", () =>
    runConversationTurn({ workspaceId, leadId, conversationId, messageId: rowId, message: c.body }),
  );
}

async function providerEventIdOf(rowId: string): Promise<string | undefined> {
  const row = await prisma.whatsAppMessage.findUnique({ where: { id: rowId }, select: { externalId: true } });
  return row?.externalId ?? undefined;
}

/** On a replay, a consent row written for this message — or any later decision for the same number — must not be overwritten. */
async function consentSupersedes(c: PostCommitContext, rowId: string): Promise<boolean> {
  if (!c.redrive) return false;
  const address = consentAddress("WHATSAPP", c.phone);
  if (!address) return false;
  const message = await prisma.whatsAppMessage.findUnique({ where: { id: rowId }, select: { sentAt: true } });
  const existing = await prisma.messagingConsent.findFirst({
    where: {
      workspaceId: c.workspaceId,
      channel: "WHATSAPP",
      address,
      OR: [{ evidence: `whatsapp message ${rowId}` }, ...(message ? [{ capturedAt: { gte: message.sentAt } }] : [])],
    },
    select: { id: true },
  });
  return Boolean(existing);
}

async function outboundFollowsInbound(workspaceId: string, conversationId: string, inboundRowId: string): Promise<boolean> {
  const inbound = await prisma.whatsAppMessage.findUnique({ where: { id: inboundRowId }, select: { sentAt: true } });
  if (!inbound) return false;
  const later = await prisma.whatsAppMessage.findFirst({
    where: { workspaceId, conversationId, direction: "OUTBOUND", sentAt: { gt: inbound.sentAt } },
    select: { id: true },
  });
  return Boolean(later);
}

async function markEventProcessed(provider: string, externalEventId: string) {
  await prisma.webhookEvent.updateMany({
    where: { provider, externalEventId, processedAt: null },
    data: { processedAt: new Date() },
  });
}

export const WEBHOOK_RECOVERY_MAX_ATTEMPTS = 5;
const WEBHOOK_RECOVERY_MIN_AGE_MS = 2 * 60_000;

/**
 * Re-drives inbound WhatsApp events whose claim committed but whose post-commit steps never finished (process died
 * between the transaction and the automations / consent / handoff / conversation turn). Meta's own retry cannot help:
 * the claim makes it return "duplicate". Replays are idempotent per step; an event that keeps failing is logged as
 * exhausted after WEBHOOK_RECOVERY_MAX_ATTEMPTS and left for a human (it is never silently dropped).
 */
export async function recoverStalledWebhookEvents(options: { now?: Date; limit?: number; workspaceId?: string } = {}) {
  const cutoff = new Date((options.now ?? new Date()).getTime() - WEBHOOK_RECOVERY_MIN_AGE_MS);
  const stalled = await prisma.webhookEvent.findMany({
    where: { provider: "whatsapp", processedAt: null, createdAt: { lt: cutoff }, ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}) },
    orderBy: { createdAt: "asc" },
    take: options.limit ?? 50,
  });

  const result = { redriven: 0, failed: 0, exhausted: 0 };
  for (const event of stalled) {
    if (event.attempts >= WEBHOOK_RECOVERY_MAX_ATTEMPTS) {
      result.exhausted += 1;
      console.error(`[webhook-recovery] EXHAUSTED event=${event.id} externalEventId=${event.externalEventId} workspace=${event.workspaceId} attempts=${event.attempts}`);
      continue;
    }
    // Optimistic claim on the attempt counter: two overlapping sweeps cannot both replay the same event.
    const claimed = await prisma.webhookEvent.updateMany({
      where: { id: event.id, processedAt: null, attempts: event.attempts },
      data: { attempts: { increment: 1 } },
    });
    if (claimed.count === 0) continue;
    try {
      await redriveInboundEvent(event.workspaceId, event.externalEventId);
      await markEventProcessed(event.provider, event.externalEventId);
      result.redriven += 1;
    } catch (error) {
      result.failed += 1;
      console.error(
        `[webhook-recovery] event=${event.id} attempt=${event.attempts + 1} failed`,
        error instanceof Error ? error.message.split("\n")[0] : "unknown_error",
      );
    }
  }
  return result;
}

async function redriveInboundEvent(workspaceId: string | null, externalId: string) {
  if (!workspaceId) return;
  const message = await prisma.whatsAppMessage.findFirst({
    where: { workspaceId, provider: "whatsapp-business", externalId, direction: "INBOUND" },
  });
  // No persisted message means the claim itself was rolled back or the lead is gone: nothing to replay.
  if (!message?.leadId) return;
  const lead = await prisma.lead.findFirst({ where: { id: message.leadId, workspaceId, deletedAt: null } });
  if (!lead) return;

  const earlier = await prisma.whatsAppMessage.findFirst({
    where: { workspaceId, leadId: lead.id, direction: "INBOUND", sentAt: { lt: message.sentAt }, id: { not: message.id } },
    orderBy: { sentAt: "desc" },
    select: { body: true },
  });
  const meta = (message.metadata ?? {}) as Record<string, unknown>;
  const extractable = !meta.unsupportedType;
  await runPostCommitSteps({
    workspaceId,
    leadId: lead.id,
    ownerId: lead.ownerId,
    phone: lead.whatsappNumber ?? lead.phone ?? "",
    body: message.body,
    rowId: message.id,
    extractable,
    extracted: extractable ? extractRequirement(message.body) : {},
    isNewLead: !earlier && lead.source === "WHATSAPP_INBOUND",
    existingLead: lead as unknown as RequirementSnapshot,
    previousMessage: earlier?.body ?? null,
    redrive: true,
  });
}

export async function processWhatsAppWebhook(
  rawBody: string,
  signatureHeader: string | null,
): Promise<WebhookProcessResult> {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) {
    throw new ApiError(503, "WhatsApp webhook is not configured");
  }
  if (!signatureHeader) {
    throw new ApiError(401, "Missing webhook signature");
  }
  const valid = await measureExecution("webhook.signature", async () =>
    verifyHubSignature256(rawBody, signatureHeader, secret),
  );
  if (!valid) {
    throw new ApiError(401, "Invalid webhook signature");
  }

  let payload: CloudPayload;
  try {
    payload = await measureExecution("webhook.parse", async () => JSON.parse(rawBody) as CloudPayload);
  } catch {
    throw new ApiError(400, "Invalid JSON");
  }

  const changes = payload.entry?.flatMap((entry) => entry.changes ?? []) ?? [];
  const phoneNumberId = changes.find((change) => change.value?.metadata?.phone_number_id)?.value?.metadata
    ?.phone_number_id;

  if (!phoneNumberId) {
    return { status: "accepted", stored: 0, duplicates: 0 };
  }

  const workspaceId = await resolveWorkspaceId(phoneNumberId);
  if (!workspaceId) {
    throw new ApiError(403, "Unknown WhatsApp phone number");
  }

  let stored = 0;
  let duplicates = 0;

  for (const change of changes) {
    const messages = change.value?.messages ?? [];
    const contactsByWaId = new Map(
      (change.value?.contacts ?? []).map((c) => [c.wa_id, c.profile?.name ?? null]),
    );
    for (const msg of messages) {
      if (!msg.from || !msg.id) continue;
      const text = msg.type === "text" ? msg.text?.body?.trim() : undefined;
      const extractable = Boolean(text);
      const body = extractable ? text! : `[Unsupported WhatsApp message: ${msg.type ?? "unknown"}]`;

      // Meta sends `from` as full international digits without the plus. Canonicalize for
      // identity, but fall back to the raw +digits form rather than dropping a real inbound
      // message: threading an unparseable number is better than losing the customer's reply.
      const phone = canonicalPhone(`+${msg.from.replace(/[^\d]/g, "")}`) ?? `+${msg.from.replace(/[^\d]/g, "")}`;
      const result = await storeInboundMessage({
        workspaceId,
        phone,
        body,
        externalId: msg.id,
        profileName: contactsByWaId.get(msg.from) ?? null,
        extractable,
        metadata: extractable ? undefined : { unsupportedType: msg.type ?? "unknown" },
      });
      if (result === "created") stored += 1;
      else duplicates += 1;
    }

    for (const status of change.value?.statuses ?? []) {
      await applyStatusUpdate(workspaceId, status);
    }
  }

  if (stored === 0 && duplicates > 0) {
    return { status: "duplicate", stored, duplicates };
  }
  if (stored === 0) {
    return { status: "accepted", stored, duplicates };
  }
  return { status: "stored", stored, duplicates };
}
