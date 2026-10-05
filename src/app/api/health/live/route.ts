import { NextResponse } from "next/server";

/**
 * LIVENESS. Public, no dependencies, no database: answers "is the process up and serving requests". Cheap enough
 * for an external uptime monitor. It deliberately says nothing about Postgres, Meta or any other dependency;
 * /api/health is the readiness check. A failing dependency should not make an orchestrator restart a healthy process.
 */
export function GET() {
  return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
