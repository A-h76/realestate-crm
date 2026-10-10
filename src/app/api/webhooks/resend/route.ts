import { NextResponse } from "next/server";
import { ApiError } from "@/lib/errors";
import { jsonError } from "@/lib/api";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { clientIp } from "@/lib/security/request";
import { processResendInbound } from "@/lib/webhooks/resend-inbound";
import { logEvent } from "@/lib/log";
import { measuredRoute } from "@/lib/perf";

/** Resend receiving webhook (`email.received`), Svix-signed. */
export const POST = measuredRoute("POST /api/webhooks/resend", async (request: Request) => {
  try {
    await enforceRateLimit({ key: `webhook:resend:${clientIp(request)}`, ...RATE_LIMITS.webhook });
    const rawBody = await request.text();
    const result = await processResendInbound(rawBody, {
      id: request.headers.get("svix-id"),
      timestamp: request.headers.get("svix-timestamp"),
      signature: request.headers.get("svix-signature"),
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof ApiError) return jsonError(error);
    logEvent("error", "resend_webhook_failed", { error });
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
});
