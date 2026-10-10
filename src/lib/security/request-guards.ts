const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Reachable without a session: auth, health, provider webhooks (HMAC-verified) and the public intake forms (per-form key).
const PUBLIC_PATHS = new Set(["/login", "/accept-invite", "/api/health", "/api/health/live"]);
const PUBLIC_PREFIXES = ["/api/auth", "/api/webhooks/whatsapp", "/api/webhooks/meta", "/api/webhooks/resend", "/api/intake"];

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

// Server-to-server (HMAC) or Auth.js endpoints with their own CSRF token, and the public intake forms (no cookies, no session:
// they enforce their own per-form origin allow-list).
const ORIGIN_CHECK_EXEMPT = ["/api/webhooks/", "/api/auth/", "/api/intake/"];

export const MAX_API_BODY_BYTES = 1_048_576;
// CSV import allows 1MB of CSV text; leave headroom for encoding/overhead.
const BODY_LIMIT_OVERRIDES: Record<string, number> = { "/api/leads/csv": 2 * 1_048_576 };

/**
 * CSRF defence in depth on top of SameSite=Lax: a cookie-authenticated API mutation must come
 * from our own origin. Browsers always send Origin on cross-origin and non-GET fetches; requests
 * with neither Origin nor Sec-Fetch-Site are non-browser clients, which carry no ambient cookies.
 */
export function isCrossOriginMutation(method: string, pathname: string, headers: Headers): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return false;
  if (!pathname.startsWith("/api/") || ORIGIN_CHECK_EXEMPT.some((prefix) => pathname.startsWith(prefix))) {
    return false;
  }
  if (headers.get("sec-fetch-site") === "cross-site") return true;
  const origin = headers.get("origin");
  if (!origin) return false;
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

/** Declared body larger than the route allows. Chunked bodies are bounded by proxyClientMaxBodySize. */
export function isOversizedBody(pathname: string, headers: Headers): boolean {
  if (!pathname.startsWith("/api/")) return false;
  const length = Number(headers.get("content-length") ?? 0);
  return length > (BODY_LIMIT_OVERRIDES[pathname] ?? MAX_API_BODY_BYTES);
}
