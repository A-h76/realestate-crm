import { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { notify } from "@/lib/notifications";
import { writeAudit } from "@/lib/audit";
import { normalizePkPhone } from "@/lib/format";
import { verifyHubSignature256 } from "@/lib/security/hmac";
import { measureExecution } from "@/lib/perf";

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
        statuses?: Array<{ id?: string }>;
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

async function storeInboundMessage(input: {
  workspaceId: string;
  phone: string;
  body: string;
  externalId: string;
}): Promise<"created" | "duplicate"> {
  const [lead, contact] = await measureExecution("webhook.lookups", () =>
    Promise.all([
      prisma.lead.findFirst({
        where: {
          workspaceId: input.workspaceId,
          deletedAt: null,
          OR: [{ whatsappNumber: input.phone }, { phone: input.phone }],
        },
        select: { id: true, ownerId: true },
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
  const conversationId = lead ? `lead:${lead.id}` : `wa:${input.phone}`;

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
            metadata: { webhook: true },
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
    for (const msg of messages) {
      if (!msg.from || !msg.id) continue;
      const body = msg.text?.body;
      if (!body) continue;

      const phone = normalizePkPhone(msg.from) ?? `+${msg.from.replace(/[^\d]/g, "")}`;
      const result = await storeInboundMessage({
        workspaceId,
        phone,
        body,
        externalId: msg.id,
      });
      if (result === "created") stored += 1;
      else duplicates += 1;
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
