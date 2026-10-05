/** Static headers. The Content-Security-Policy is per request (it carries a nonce): see buildCsp / applySecurityHeaders. */
export const SECURITY_HEADERS: Array<{ key: string; value: string }> = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

export function hstsHeader(): { key: string; value: string } | null {
  if (process.env.NODE_ENV !== "production") return null;
  if (process.env.DISABLE_HSTS === "true") return null;
  return {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  };
}

/**
 * SEC-010. Scripts: only the framework's own scripts, which Next tags with this request's nonce, plus whatever those
 * load ('strict-dynamic'). No 'unsafe-inline', so an injected inline <script> or onclick handler does not run.
 * Styles still allow 'unsafe-inline': React renders style="..." attributes, which a nonce cannot cover, so the
 * policy is NOT fully strict. 'unsafe-eval' is for the dev server only.
 */
export function buildCsp(nonce: string, dev = process.env.NODE_ENV === "development"): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://images.unsplash.com",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

/** A fresh unpredictable value per request (CSP nonces must never repeat). */
export function newNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}

export function applySecurityHeaders(headers: Headers, nonce: string): void {
  for (const header of SECURITY_HEADERS) {
    headers.set(header.key, header.value);
  }
  headers.set("Content-Security-Policy", buildCsp(nonce));
  const hsts = hstsHeader();
  if (hsts) headers.set(hsts.key, hsts.value);
}
