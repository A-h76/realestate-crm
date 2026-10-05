import type { WhatsAppMessage } from "@prisma/client";
import { prisma } from "@/lib/db";
import { canonicalPhone } from "@/lib/phone";
import { logEvent } from "@/lib/log";
import type {
  WhatsAppDraftInput,
  WhatsAppProvider,
  WhatsAppSendInput,
} from "./types";

const DEFAULT_GRAPH_VERSION = "v21.0";
const SEND_TIMEOUT_MS = 10_000;

/**
 * Retry policy for outbound sends (INTG-009). The Cloud API has no idempotency key, so a send is only ever retried
 * when we KNOW the previous attempt was not accepted:
 *   - HTTP 429 / throttling error codes (Meta rejected it before processing), or
 *   - the TCP connection was never established (DNS failure, connection refused).
 * A timeout, a dropped connection mid-request, a 5xx, or a 2xx without a message id are ambiguous: the message may
 * have been delivered. Those are NOT retried (that could message a customer twice); they are stored as FAILED with
 * `deliveryUnknown: true` so a person checks the chat before resending. Mutable so tests can shorten the delays.
 */
export const sendRetryPolicy = { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 5_000 };

const THROTTLE_CODES = new Set(["4", "17", "32", "613", "80007", "130429", "131056"]);
const NEVER_CONNECTED = new Set(["ENOTFOUND", "ECONNREFUSED", "EAI_AGAIN"]);

/** unreachable: the connection to Meta never opened, so the message was certainly not sent. */
export type SendFailureKind = "rate_limited" | "unreachable" | "permanent" | "delivery_unknown";

type GraphSendResult =
  | { ok: true; providerMessageId: string; attempts: number }
  | {
      ok: false;
      kind: SendFailureKind;
      status: number | null;
      code: string | null;
      message: string;
      attempts: number;
    };

type Attempt =
  | { ok: true; providerMessageId: string }
  | { ok: false; kind: SendFailureKind; retryable: boolean; retryAfterMs: number | null; status: number | null; code: string | null; message: string };

/** Digits-only destination as the Cloud API `to` field expects. */
function toGraphPhone(phone: string): string {
  return phone.replace(/[^\d]/g, "");
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function connectionNeverEstablished(error: unknown): boolean {
  const code = (error as { cause?: { code?: unknown } })?.cause?.code;
  return typeof code === "string" && NEVER_CONNECTED.has(code);
}

async function attemptGraphSend(to: string, body: string): Promise<Attempt> {
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
      const code = error?.code != null ? String(error.code) : null;
      const message = typeof error?.message === "string" ? error.message : `Meta API error (${res.status})`;
      const retryAfter = Number(res.headers.get("retry-after"));
      const retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : null;
      if (res.status === 429 || (code && THROTTLE_CODES.has(code))) {
        return { ok: false, kind: "rate_limited", retryable: true, retryAfterMs, status: res.status, code, message };
      }
      if (res.status >= 500) {
        return { ok: false, kind: "delivery_unknown", retryable: false, retryAfterMs: null, status: res.status, code, message };
      }
      return { ok: false, kind: "permanent", retryable: false, retryAfterMs: null, status: res.status, code, message };
    }

    const providerMessageId = (data as { messages?: Array<{ id?: string }> }).messages?.[0]?.id;
    if (!providerMessageId) {
      return {
        ok: false,
        kind: "delivery_unknown",
        retryable: false,
        retryAfterMs: null,
        status: res.status,
        code: null,
        message: "Meta API accepted the request but returned no message id",
      };
    }
    return { ok: true, providerMessageId };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    const neverConnected = !timedOut && connectionNeverEstablished(error);
    return {
      ok: false,
      kind: neverConnected ? "unreachable" : "delivery_unknown",
      retryable: neverConnected,
      retryAfterMs: null,
      status: null,
      code: timedOut ? "timeout" : neverConnected ? "connection_failed" : "network_error",
      message: timedOut ? "Meta API request timed out" : "Meta API request failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Calls the Meta WhatsApp Cloud API directly, with bounded retries for the provably-not-sent cases only (see
 * `sendRetryPolicy`). Isolated here so the rest of the app only ever talks to WhatsAppProvider, never the Graph API.
 */
export async function sendViaGraphApi(to: string, body: string): Promise<GraphSendResult> {
  let attempts = 0;
  for (;;) {
    attempts += 1;
    const result = await attemptGraphSend(to, body);
    if (result.ok) return { ok: true, providerMessageId: result.providerMessageId, attempts };
    if (!result.retryable || attempts >= sendRetryPolicy.maxAttempts) {
      return { ok: false, kind: result.kind, status: result.status, code: result.code, message: result.message, attempts };
    }
    const backoff = sendRetryPolicy.baseDelayMs * 2 ** (attempts - 1) * (0.75 + Math.random() * 0.5);
    await sleep(Math.min(result.retryAfterMs ?? backoff, sendRetryPolicy.maxDelayMs));
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

  /** When set, every send is stored as FAILED with this reason and nothing is called (see getWhatsAppProvider). */
  constructor(private readonly opts: { blockedReason?: string } = {}) {}

  private configured() {
    return !this.opts.blockedReason && Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
  }

  /**
   * Resolves the destination from the lead/opportunity the conversation is tied to, as a
   * canonical E.164 number. A stored value that does not parse to a complete valid number
   * yields null, and the caller records the send as FAILED ("no_recipient") — we never hand a
   * provider a half-normalized number that could reach the wrong party (US-02).
   */
  private async resolveDestination(workspaceId: string, input: WhatsAppSendInput): Promise<string | null> {
    if (input.leadId) {
      const lead = await prisma.lead.findFirst({
        where: { id: input.leadId, workspaceId },
        select: { whatsappNumber: true, phone: true },
      });
      const raw = lead?.whatsappNumber ?? lead?.phone ?? null;
      return canonicalPhone(raw);
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
      return canonicalPhone(raw);
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
          metadata: {
            error: this.opts.blockedReason ?? "WhatsApp Business credentials are not configured. Message stored in CRM but not sent.",
            failureKind: "not_configured",
          },
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
          metadata: { error: "No WhatsApp number on file for this recipient.", failureKind: "no_recipient" },
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
          ? { notice: "Sent via WhatsApp Business Cloud API.", attempts: result.attempts, ...input.metadata }
          : {
              error: result.message,
              errorCode: result.code,
              httpStatus: result.status,
              failureKind: result.kind,
              attempts: result.attempts,
              // true = Meta may have accepted it; a person must check the chat before resending (could duplicate).
              deliveryUnknown: result.kind === "delivery_unknown",
              ...input.metadata,
            },
      },
    });

    if (!result.ok) {
      logEvent("error", "whatsapp_send_failed", {
        provider: "whatsapp-business",
        messageId: message.id,
        httpStatus: result.status,
        errorCode: result.code,
        failureKind: result.kind,
        attempts: result.attempts,
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
