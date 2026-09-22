import { Prisma, type WhatsAppMessageStatus } from "@prisma/client";
import { ApiError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { notify } from "@/lib/notifications";
import { writeAudit } from "@/lib/audit";
import { normalizePkPhone } from "@/lib/format";
import { verifyHubSignature256 } from "@/lib/security/hmac";
import { measureExecution } from "@/lib/perf";
import { createLead } from "@/lib/leads/create-lead";
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

/** Meta delivery-status webhook (sent/delivered/read/failed) for an outbound message we sent. */
async function applyStatusUpdate(workspaceId: string, status: { id?: string; status?: string }) {
  if (!status.id || !status.status) return;
  const mapped = META_STATUS_MAP[status.status];
  if (!mapped) return;
  await measureExecution("webhook.status", () =>
    prisma.whatsAppMessage.updateMany({
      where: { workspaceId, provider: "whatsapp-business", externalId: status.id, direction: "OUTBOUND" },
      data: { status: mapped },
    }),
  );
}

async function storeInboundMessage(input: {
  workspaceId: string;
  phone: string;
  body: string;
  externalId: string;
  profileName: string | null;
  /** false for non-text message types: skip requirement extraction and handoff detection on the placeholder body. */
  extractable: boolean;
  metadata?: Record<string, unknown>;
}): Promise<"created" | "duplicate"> {
  const [existingLead, contact] = await measureExecution("webhook.lookups", () =>
    Promise.all([
      prisma.lead.findFirst({
        where: {
          workspaceId: input.workspaceId,
          deletedAt: null,
          OR: [{ whatsappNumber: input.phone }, { phone: input.phone }],
        },
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
      }),
      prisma.contact.findFirst({
        where: {
          workspaceId: input.workspaceId,
          deletedAt: null,
          OR: [{ whatsappNumber: input.phone }, { phone: input.phone }],
        },
        select: { id: true },
      }),
    ]),
  );

  const extracted = input.extractable ? extractRequirement(input.body) : {};
  let lead: { id: string; ownerId: string | null };
  let previousMessage: string | null = null;

  if (existingLead) {
    lead = existingLead;
    const [, prevMessage] = await Promise.all([
      applyRequirementUpdate(
        input.workspaceId,
        existingLead.id,
        existingLead as unknown as RequirementSnapshot,
        extracted,
      ),
      prisma.whatsAppMessage.findFirst({
        where: { workspaceId: input.workspaceId, leadId: existingLead.id, direction: "INBOUND" },
        orderBy: { sentAt: "desc" },
        select: { body: true },
      }),
    ]);
    previousMessage = prevMessage?.body ?? null;
  } else {
    const [firstName, ...rest] = (
      input.profileName?.trim() || `WhatsApp Lead ${input.phone.slice(-4)}`
    ).split(/\s+/);
    const created = await measureExecution("webhook.createLead", () =>
      createLead(input.workspaceId, null, {
        firstName,
        lastName: rest.join(" ") || null,
        phone: input.phone,
        whatsappNumber: input.phone,
        source: "WHATSAPP_INBOUND",
        ...extracted,
      }),
    );
    lead = created;
  }

  const conversationId = `lead:${lead.id}`;

  try {
    const row = await measureExecution("webhook.persist", () =>
      prisma.$transaction(async (tx) => {
        await tx.webhookEvent.create({
          data: {
            provider: "whatsapp",
            externalEventId: input.externalId,
            workspaceId: input.workspaceId,
          },
        });
        return tx.whatsAppMessage.create({
          data: {
            workspaceId: input.workspaceId,
            conversationId,
            direction: "INBOUND",
            body: input.body,
            status: "DELIVERED",
            leadId: lead?.id,
            contactId: contact?.id,
            provider: "whatsapp-business",
            externalId: input.externalId,
            metadata: { webhook: true, ...input.metadata },
          },
          select: { id: true },
        });
      }),
    );

    await writeAudit({
      workspaceId: input.workspaceId,
      action: "WHATSAPP_MESSAGE_LOGGED",
      entity: "WhatsAppMessage",
      entityId: row.id,
      metadata: { direction: "INBOUND", webhook: true },
    });

    if (lead?.ownerId) {
      await measureExecution("webhook.notify", () =>
        notify({
          workspaceId: input.workspaceId,
          userId: lead.ownerId!,
          type: "WHATSAPP_RECEIVED",
          title: "WhatsApp message received",
          body: "New inbound WhatsApp message",
          href: `/leads/${lead.id}`,
          entityType: "Lead",
          entityId: lead.id,
        }),
      );
    }

    if (input.extractable) {
      const detection = detectHandoff(input.body, { previousMessage });
      if (detection.shouldHandoff) {
        await measureExecution("webhook.handoff", () =>
          triggerHandoff({
            workspaceId: input.workspaceId,
            leadId: lead.id,
            detection,
            triggerMessage: input.body,
            triggerMessageId: row.id,
          }),
        );
      } else {
        // Only a non-handoff customer message ever reaches the automatic
        // conversational reply — never re-entered by our own outbound sends
        // or by Meta status callbacks, which are handled separately above.
        await measureExecution("webhook.conversation", () =>
          runConversationTurn({
            workspaceId: input.workspaceId,
            leadId: lead.id,
            conversationId,
            messageId: row.id,
            message: input.body,
          }),
        );
      }
    }
    return "created";
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return "duplicate";
    }
    throw error;
  }
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

      const phone = normalizePkPhone(msg.from) ?? `+${msg.from.replace(/[^\d]/g, "")}`;
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
