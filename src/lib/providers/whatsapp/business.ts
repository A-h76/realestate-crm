import type { WhatsAppMessage } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizePkPhone } from "@/lib/format";
import type {
  WhatsAppDraftInput,
  WhatsAppProvider,
  WhatsAppSendInput,
} from "./types";

const DEFAULT_GRAPH_VERSION = "v21.0";
const SEND_TIMEOUT_MS = 10_000;

type GraphSendResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; status: number | null; code: string | null; message: string };

/** Digits-only destination as the Cloud API `to` field expects. */
function toGraphPhone(phone: string): string {
  return phone.replace(/[^\d]/g, "");
}

/**
 * Calls the Meta WhatsApp Cloud API directly. Isolated here so the rest of
 * the app only ever talks to WhatsAppProvider, never the Graph API.
 */
async function sendViaGraphApi(to: string, body: string): Promise<GraphSendResult> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN!;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID!;
  const version = process.env.WHATSAPP_GRAPH_API_VERSION || DEFAULT_GRAPH_VERSION;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body },
      }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}) as Record<string, unknown>);

    if (!res.ok) {
      const error = (data as { error?: { message?: string; code?: number | string } }).error;
      return {
        ok: false,
        status: res.status,
        code: error?.code != null ? String(error.code) : null,
        message: typeof error?.message === "string" ? error.message : `Meta API error (${res.status})`,
      };
    }

    const providerMessageId = (data as { messages?: Array<{ id?: string }> }).messages?.[0]?.id;
    if (!providerMessageId) {
      return { ok: false, status: res.status, code: null, message: "Meta API accepted the request but returned no message id" };
    }
    return { ok: true, providerMessageId };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      status: null,
      code: timedOut ? "timeout" : "network_error",
      message: timedOut ? "Meta API request timed out" : "Meta API request failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * WhatsApp Business Cloud API provider. Live Graph API sends only run when
 * an access token and phone number id are present; otherwise (or on Meta
 * rejection) the message is stored as FAILED and never pretended to have
 * been delivered.
 */
export class WhatsAppBusinessProvider implements WhatsAppProvider {
  readonly name = "whatsapp-business";
  readonly isDemo = false;

  private configured() {
    return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
  }

  /** Resolves the destination WhatsApp number from the lead/opportunity the conversation is tied to. */
  private async resolveDestination(workspaceId: string, input: WhatsAppSendInput): Promise<string | null> {
    if (input.leadId) {
      const lead = await prisma.lead.findFirst({
        where: { id: input.leadId, workspaceId },
        select: { whatsappNumber: true, phone: true },
      });
      const raw = lead?.whatsappNumber ?? lead?.phone ?? null;
      return raw ? normalizePkPhone(raw) : null;
    }
    if (input.opportunityId) {
      const opportunity = await prisma.opportunity.findFirst({
        where: { id: input.opportunityId, workspaceId },
        select: {
          primaryContact: { select: { whatsappNumber: true, phone: true } },
          lead: { select: { whatsappNumber: true, phone: true } },
        },
      });
      const raw =
        opportunity?.primaryContact?.whatsappNumber ??
        opportunity?.primaryContact?.phone ??
        opportunity?.lead?.whatsappNumber ??
        opportunity?.lead?.phone ??
        null;
      return raw ? normalizePkPhone(raw) : null;
    }
    return null;
  }

  async sendMessage(workspaceId: string, input: WhatsAppSendInput): Promise<WhatsAppMessage> {
    if (!this.configured()) {
      return prisma.whatsAppMessage.create({
        data: {
          workspaceId,
          conversationId: input.conversationId,
          direction: "OUTBOUND",
          body: input.body,
          status: "FAILED",
          leadId: input.leadId,
          opportunityId: input.opportunityId,
          senderId: input.senderId,
          provider: "whatsapp-business",
          metadata: { error: "WhatsApp Business credentials are not configured. Message stored in CRM but not sent." },
        },
      });
    }

    const to = await this.resolveDestination(workspaceId, input);
    if (!to) {
      return prisma.whatsAppMessage.create({
        data: {
          workspaceId,
          conversationId: input.conversationId,
          direction: "OUTBOUND",
          body: input.body,
          status: "FAILED",
          leadId: input.leadId,
          opportunityId: input.opportunityId,
          senderId: input.senderId,
          provider: "whatsapp-business",
          metadata: { error: "No WhatsApp number on file for this recipient." },
        },
      });
    }

    const result = await sendViaGraphApi(toGraphPhone(to), input.body);

    const message = await prisma.whatsAppMessage.create({
      data: {
        workspaceId,
        conversationId: input.conversationId,
        direction: "OUTBOUND",
        body: input.body,
        status: result.ok ? "SENT" : "FAILED",
        leadId: input.leadId,
        opportunityId: input.opportunityId,
        senderId: input.senderId,
        provider: "whatsapp-business",
        externalId: result.ok ? result.providerMessageId : undefined,
        metadata: result.ok
          ? { notice: "Sent via WhatsApp Business Cloud API.", ...input.metadata }
          : { error: result.message, errorCode: result.code, httpStatus: result.status },
      },
    });

    if (!result.ok) {
      console.error("whatsapp_send_failed", {
        messageId: message.id,
        httpStatus: result.status,
        errorCode: result.code,
      });
    }

    return message;
  }

  async draftMessage(workspaceId: string, input: WhatsAppDraftInput): Promise<WhatsAppMessage> {
    return prisma.whatsAppMessage.create({
      data: {
        workspaceId,
        conversationId: input.conversationId,
        direction: "OUTBOUND",
        body: input.body,
        status: "DRAFT",
        leadId: input.leadId,
        opportunityId: input.opportunityId,
        senderId: input.senderId,
        provider: "whatsapp-business",
        metadata: { notice: "Draft stored. Not sent." },
      },
    });
  }

  async listMessages(workspaceId: string, conversationId: string): Promise<WhatsAppMessage[]> {
    return prisma.whatsAppMessage.findMany({
      where: { workspaceId, conversationId },
      orderBy: { sentAt: "asc" },
    });
  }

  async getThread(workspaceId: string, conversationId: string) {
    const messages = await this.listMessages(workspaceId, conversationId);
    return {
      conversationId,
      messages,
      provider: this.name,
      isDemo: false,
    };
  }
}
