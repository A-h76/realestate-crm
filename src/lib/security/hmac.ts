import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies Meta's `X-Hub-Signature-256` header against the raw request body.
 * Comparison is length-checked and timing-safe.
 */
export function verifyHubSignature256(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
  const provided = Buffer.from(signatureHeader);
  const computed = Buffer.from(expected);
  if (provided.length !== computed.length) return false;
  return timingSafeEqual(provided, computed);
}
