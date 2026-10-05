/**
 * SEC-003: X-Real-IP is trusted for rate-limit bucketing only, on the ASSUMPTION that this app is
 * reachable solely through Railway's edge and that the edge overwrites any client-supplied value.
 * Railway documents X-Real-IP as an edge-set header
 * (https://docs.railway.com/networking/public-networking/specs-and-limits#technical-specifications),
 * but that has NOT been verified against the live deployment from this repository. Operator check:
 * docs/ops/BATCH1-OPERATOR-CHECKLIST.md section 3. If the app is ever put behind a different proxy,
 * or the check fails, stop trusting the header. The leftmost X-Forwarded-For entry is client-controlled
 * and is never used. Values that are not IP-shaped are ignored.
 */
const IPV4_OR_IPV6 = /^[0-9a-fA-F:.]+$/;

function looksLikeIp(value: string): boolean {
  return value.length > 0 && value.length <= 45 && IPV4_OR_IPV6.test(value);
}

/**
 * Client IP for rate limiting. The leftmost X-Forwarded-For entry is whatever the client
 * sent, so it is never trusted. Railway's edge sets X-Real-IP to the connecting client;
 * failing that, the rightmost X-Forwarded-For hop is the one our own proxy appended.
 */
export function clientIp(request: Request): string {
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp && looksLikeIp(realIp)) return realIp;
  const hops = request.headers.get("x-forwarded-for")?.split(",").map((hop) => hop.trim()).filter(Boolean);
  const last = hops?.at(-1);
  if (last && looksLikeIp(last)) return last;
  return "unknown";
}

export function identifierKey(value: string | null | undefined): string {
  return (value ?? "unknown").trim().toLowerCase().slice(0, 180);
}
