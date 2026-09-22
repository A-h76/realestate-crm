import { getRequestId } from "@/lib/perf";

/**
 * Forensic trace for security-relevant failures (401/403/429, failed logins).
 * Deliberately separate from AuditLog (business events, DB-backed, user-facing)
 * and from [PERF] logs (timing) — this is server-side-only, console-based, and
 * exists so an incident has *some* trace without pulling in a logging framework.
 */
export function logSecurityEvent(input: {
  status: number;
  message: string;
  detail?: Record<string, unknown>;
}) {
  const requestId = getRequestId();
  const parts = [
    "[SECURITY]",
    requestId ? `requestId=${requestId}` : null,
    `status=${input.status}`,
    `message=${input.message}`,
  ].filter(Boolean);
  console.warn(parts.join(" "), input.detail ?? "");
}
