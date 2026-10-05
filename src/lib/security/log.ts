import { logEvent } from "@/lib/log";

/**
 * Forensic trace for security-relevant failures (401/403/429, failed logins).
 * Deliberately separate from AuditLog (business events, DB-backed, user-facing)
 * and from [PERF] logs (timing): this is server-side-only structured stdout (see
 * src/lib/log.ts) and exists so an incident has a trace without a logging framework.
 */
export function logSecurityEvent(input: {
  status: number;
  message: string;
  detail?: Record<string, unknown>;
}) {
  logEvent("warn", "security_event", { status: input.status, message: input.message, ...input.detail });
}
