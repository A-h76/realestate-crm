import { NextResponse } from "next/server";
import { checkDatabaseHealth } from "@/lib/health";

/** Public, unauthenticated. Used by Railway's healthcheck to gate deploys on real DB connectivity. */
export async function GET() {
  const health = await checkDatabaseHealth();
  return NextResponse.json(
    { status: health.ok ? "ok" : "error", database: health.database, latencyMs: health.latencyMs },
    { status: health.ok ? 200 : 503 },
  );
}
