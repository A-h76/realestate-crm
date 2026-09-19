export const SECURITY_HEADERS: Array<{ key: string; value: string }> = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js App Router emits inline scripts/styles for hydration and CSS-in-JS.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  },
];

export function hstsHeader(): { key: string; value: string } | null {
  if (process.env.NODE_ENV !== "production") return null;
  if (process.env.DISABLE_HSTS === "true") return null;
  return {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  };
}

export function applySecurityHeaders(headers: Headers): void {
  for (const header of SECURITY_HEADERS) {
    headers.set(header.key, header.value);
  }
  const hsts = hstsHeader();
  if (hsts) headers.set(hsts.key, hsts.value);
}
