import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies a Svix-signed webhook (what Resend uses): signature = base64(HMAC-SHA256(secret, `${id}.${timestamp}.${rawBody}`)),
 * sent as "v1,<sig>" (several may be listed, space separated, during secret rotation). The secret is "whsec_<base64>".
 * Rejects timestamps more than `toleranceSec` from now, so a captured request cannot be replayed later.
 */
export function verifySvixSignature(
  rawBody: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  secret: string,
  now: number = Date.now(),
  toleranceSec = 300,
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !secret) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > toleranceSec) return false;
  const expected = createHmac("sha256", Buffer.from(secret.replace(/^whsec_/, ""), "base64")).update(`${id}.${timestamp}.${rawBody}`, "utf8").digest();
  return signature.split(" ").some((part) => {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) return false;
    const provided = Buffer.from(value, "base64");
    return provided.length === expected.length && timingSafeEqual(provided, expected);
  });
}
