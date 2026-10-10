/**
 * Outbound email through Resend. Per-deployment env (RESEND_API_KEY, ALERT_FROM_EMAIL), so each client pays Resend
 * directly. Used for team alerts (src/lib/alerts.ts) and the instant acknowledgement to an enquirer
 * (src/lib/intake/ack.ts). Never throws: callers get { ok: false, error } and decide.
 */
const RESEND_URL = "https://api.resend.com/emails";
const TIMEOUT_MS = 6_000;

export function emailConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.RESEND_API_KEY && env.ALERT_FROM_EMAIL);
}

export type SendResult = { ok: true } | { ok: false; error: string };

export async function sendEmail(input: { to: string; subject: string; text: string; idempotencyKey: string; replyTo?: string }): Promise<SendResult> {
  // ponytail: one retry on network/429/5xx, then give up and report the error; add a retry sweep if failures ever matter.
  let error = "unknown";
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(RESEND_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey.slice(0, 256),
        },
        body: JSON.stringify({
          from: process.env.ALERT_FROM_EMAIL,
          to: [input.to],
          subject: input.subject,
          text: input.text,
          ...(input.replyTo ? { reply_to: input.replyTo } : {}),
        }),
        signal: controller.signal,
      });
      if (res.ok) return { ok: true };
      error = `http_${res.status}`;
      if (res.status !== 429 && res.status < 500) return { ok: false, error }; // 4xx: retrying will not help
    } catch (e) {
      error = e instanceof Error ? e.name : "unknown";
    } finally {
      clearTimeout(timer);
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 500));
  }
  return { ok: false, error };
}
