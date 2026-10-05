import { NextResponse } from "next/server";
import { checkDatabaseHealth } from "@/lib/health";

/**
 * READINESS. Public and unauthenticated; Railway's deploy healthcheck points here so a release that cannot reach its
 * database never takes traffic. It runs one `SELECT 1` (bounded to 3s). The body says only ok / error: latency and
 * error detail go to the server log, not to the internet. Do not point a high-frequency uptime monitor at this;
 * use /api/health/live for that.
 */
export async function GET() {
  const health = await checkDatabaseHealth();
  return NextResponse.json({ status: health.ok ? "ok" : "error" }, { status: health.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
