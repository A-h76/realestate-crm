import { getRequestId } from "@/lib/perf";

/**
 * Structured server logs: one JSON object per line on stdout/stderr, always carrying the request id (the same id the
 * client sees in the `x-request-id` response header, so one failing request can be followed across log lines).
 * No logging framework and no log shipping is configured by this file: Railway captures stdout, and that is all
 * that is claimed. Nothing alerts on these lines unless the operator sets that up (see docs/ops/OBSERVABILITY.md).
 *
 * Privacy: values are redacted by KEY name (credentials, tokens, message bodies, contact details) and by SHAPE
 * (URL credentials, bearer tokens, long opaque strings), strings are truncated, and Errors are reduced to their name
 * and first message line. Callers should still pass identifiers (ids, counts, status codes), not content.
 */
export type LogLevel = "info" | "warn" | "error";

const REDACTED_KEYS = /pass(word)?|secret|token|authorization|cookie|signature|api[-_]?key|credential|^body$|^text$|message(body)?$|^notes?$|^phone|whatsapp(number)?$|^email$/i;
const MAX_STRING = 300;
const MAX_DEPTH = 3;

/** Strips credentials that can appear inside otherwise-harmless strings (connection URLs, headers, tokens). */
export function scrubString(value: string): string {
  return value
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[redacted]@")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[redacted]")
    .slice(0, MAX_STRING);
}

function redact(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return scrubString(value);
  if (value instanceof Error) return { name: value.name, message: scrubString(value.message.split("\n")[0]) };
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, REDACTED_KEYS.test(k) ? "[redacted]" : redact(v, depth + 1)]),
    );
  }
  return String(value);
}

/** `a***@example.com`: enough to correlate repeated failures without storing the full address. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  return domain ? `${local.slice(0, 1)}***@${domain}` : "[redacted]";
}

export function formatLogLine(level: LogLevel, event: string, fields: Record<string, unknown> = {}, requestId = getRequestId()): string {
  const safe = redact(fields) as Record<string, unknown>;
  // Reserved keys are written last so a caller's field can never overwrite them.
  return JSON.stringify({ ...safe, ts: new Date().toISOString(), level, event, ...(requestId ? { requestId } : {}) });
}

export function logEvent(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  console[level](formatLogLine(level, event, fields));
}
