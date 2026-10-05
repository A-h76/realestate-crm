import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/log";

export type HealthCheckResult = {
  ok: boolean;
  database: "ok" | "error";
  latencyMs: number;
};

/** A hung database must not hang the health check (Railway would wait for its own, longer timeout). */
export const DATABASE_CHECK_TIMEOUT_MS = 3_000;

/**
 * Readiness: verifies the app can actually reach and query Postgres, not just that the process is up.
 * The detail (latency, error text) stays in server logs; the public endpoint only reports ok / error.
 */
export async function checkDatabaseHealth(
  timeoutMs = DATABASE_CHECK_TIMEOUT_MS,
  ping: () => Promise<unknown> = () => prisma.$queryRaw`SELECT 1`, // injectable so failure modes can be tested
): Promise<HealthCheckResult> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      ping(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("database check timed out")), timeoutMs);
      }),
    ]);
    return { ok: true, database: "ok", latencyMs: elapsed() };
  } catch (error) {
    logEvent("error", "health_database_failed", { error, latencyMs: elapsed() });
    return { ok: false, database: "error", latencyMs: elapsed() };
  } finally {
    clearTimeout(timer);
  }
}
