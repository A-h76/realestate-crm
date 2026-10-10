import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { FETCH_TIMEOUTS_MS, fetchWithTimeout } from "@/lib/http";
import { logEvent } from "@/lib/log";
import { verifySvixSignature } from "@/lib/security/svix";
import { ingestEnquiry } from "@/lib/intake/ingest";

/**
 * Inbound email (Resend "receiving"). Resend POSTs a signed `email.received` event with metadata only; the body is read
 * with GET /emails/receiving/{id}. Which workspace a mailbox belongs to is an IntakeSource of kind EMAIL (externalId =
 * the receiving address), created by the operator. An email from someone we do not know becomes a lead; from someone
 * we do know (including a customer replying to our instant reply) it becomes a note on their lead and tells the owner.
 *
 * Per-deployment env: RESEND_WEBHOOK_SECRET ("whsec_...", signs the event), RESEND_API_KEY (reads the body).
 * ponytail: this is intake, not a threaded inbox. The reply is a note, and answering is still done from the team's own
 * mail client. A conversation view for email needs a channel-aware message store.
 */
type Payload = { type?: string; data?: { email_id?: string; from?: string; to?: string[]; received_for?: string[]; subject?: string } };
type Received = { text?: string | null; html?: string | null; subject?: string | null; headers?: Record<string, string> };

export type ResendInboundResult = { status: "ok" | "ignored"; outcome?: "created" | "repeat" | "duplicate_event"; reason?: string };

/** "Sara Khan <sara@x.com>" or "sara@x.com" -> name + lowercase address. */
export function parseAddress(raw: string | undefined | null): { name: string; email: string } | null {
  const text = (raw ?? "").trim();
  const angle = /^(.*)<([^<>\s]+@[^<>\s]+)>\s*$/.exec(text);
  const email = (angle ? angle[2] : text).toLowerCase();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) return null;
  const name = angle ? angle[1].replace(/["']/g, "").trim() : "";
  return { name: name || email.split("@")[0], email };
}

/** Mail that is a machine, not a person: never turn it into a lead. */
export function looksAutomated(sender: string, headers: Record<string, string> = {}): boolean {
  if (/^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce|notifications?)\b/i.test(sender.split("@")[0])) return true;
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).toLowerCase()]));
  if (lower["auto-submitted"] && lower["auto-submitted"] !== "no") return true;
  return ["bulk", "junk", "auto_reply", "list"].includes(lower["precedence"] ?? "");
}

const plain = (r: Received) =>
  (r.text?.trim() || (r.html ?? "").replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()).slice(0, 1800);

async function fetchReceived(emailId: string): Promise<Received> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new ApiError(503, "Inbound email is not configured");
  const res = await fetchWithTimeout(`https://api.resend.com/emails/receiving/${emailId}`, {
    provider: "resend",
    timeoutMs: FETCH_TIMEOUTS_MS.default,
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    logEvent("warn", "resend_inbound_fetch_failed", { httpStatus: res.status });
    throw new ApiError(502, "Could not read the received email"); // 5xx: Resend retries the webhook
  }
  return (await res.json()) as Received;
}

export async function processResendInbound(
  rawBody: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
): Promise<ResendInboundResult> {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) throw new ApiError(503, "Inbound email is not configured");
  if (!verifySvixSignature(rawBody, headers, secret)) throw new ApiError(401, "Invalid signature");

  let payload: Payload;
  try {
    payload = JSON.parse(rawBody) as Payload;
  } catch {
    throw new ApiError(400, "Invalid JSON");
  }
  const data = payload.data;
  if (payload.type !== "email.received" || !data) return { status: "ignored", reason: "not_email_received" };
  const emailId = data.email_id ?? "";
  if (!/^[\w-]{8,64}$/.test(emailId)) return { status: "ignored", reason: "bad_email_id" };

  const addresses = [...(data.received_for ?? []), ...(data.to ?? [])].map((a) => parseAddress(a)?.email).filter((a): a is string => Boolean(a));
  const mailbox = await prisma.intakeSource.findFirst({
    where: { kind: "EMAIL", externalId: { in: addresses }, enabled: true, workspace: { deletedAt: null } },
    select: { workspaceId: true, name: true },
  });
  if (!mailbox) return { status: "ignored", reason: "unknown_mailbox" };

  const sender = parseAddress(data.from);
  if (!sender) return { status: "ignored", reason: "bad_sender" };
  const ours = parseAddress(process.env.ALERT_FROM_EMAIL)?.email;
  if (looksAutomated(sender.email) || sender.email === ours) return { status: "ignored", reason: "automated_sender" };

  const received = await fetchReceived(emailId);
  if (looksAutomated(sender.email, received.headers)) return { status: "ignored", reason: "automated_sender" };

  const subject = (received.subject ?? data.subject ?? "").trim().slice(0, 200);
  const body = plain(received);
  const out = await ingestEnquiry({
    workspaceId: mailbox.workspaceId,
    source: "EMAIL",
    sourceName: `Email: ${mailbox.name}`,
    enquiry: { name: sender.name, email: sender.email, message: [subject && `Subject: ${subject}`, body].filter(Boolean).join("\n\n") },
    event: { provider: "resend-inbound", externalEventId: emailId },
  });
  return { status: "ok", outcome: out.outcome };
}
