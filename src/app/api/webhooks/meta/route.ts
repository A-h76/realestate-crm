import { NextResponse } from "next/server";
import { ApiError } from "@/lib/errors";
import { jsonError } from "@/lib/api";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { clientIp } from "@/lib/security/request";
import { processMetaLeadsWebhook } from "@/lib/webhooks/meta-leads";
import { logEvent } from "@/lib/log";
import { measuredRoute } from "@/lib/perf";

/** Meta subscribe handshake for the lead-ads (Page) webhook. */
export const GET = measuredRoute("GET /api/webhooks/meta", async (request: Request) => {
  const url = new URL(request.url);
  const verifyToken = process.env.META_VERIFY_TOKEN;
  const challenge = url.searchParams.get("hub.challenge");
  if (url.searchParams.get("hub.mode") === "subscribe" && verifyToken && url.searchParams.get("hub.verify_token") === verifyToken && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
});

export const POST = measuredRoute("POST /api/webhooks/meta", async (request: Request) => {
  try {
    await enforceRateLimit({ key: `webhook:meta:${clientIp(request)}`, ...RATE_LIMITS.webhook });
    const rawBody = await request.text();
    const result = await processMetaLeadsWebhook(rawBody, request.headers.get("x-hub-signature-256"));
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof ApiError) return jsonError(error);
    logEvent("error", "meta_webhook_failed", { error });
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
});
