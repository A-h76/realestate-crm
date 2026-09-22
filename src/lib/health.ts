import { prisma } from "@/lib/db";

export type HealthCheckResult = {
  ok: boolean;
  database: "ok" | "error";
  latencyMs: number;
};

/** Verifies the app can actually reach and query Postgres, not just that the process is up. */
export async function checkDatabaseHealth(): Promise<HealthCheckResult> {
  const started = performance.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, database: "ok", latencyMs: Math.round(performance.now() - started) };
  } catch {
    return { ok: false, database: "error", latencyMs: Math.round(performance.now() - started) };
  }
}
