import { NextResponse } from "next/server";
import { ApiError } from "@/lib/errors";
import { jsonError } from "@/lib/api";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { clientIp } from "@/lib/security/request";
import { processWhatsAppWebhook } from "@/lib/webhooks/whatsapp";
import { measuredRoute } from "@/lib/perf";


export const GET = measuredRoute("GET /api/webhooks/whatsapp", async (request: Request) => {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === "subscribe" && verifyToken && token === verifyToken && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
});

export const POST = measuredRoute("POST /api/webhooks/whatsapp", async (request: Request) => {
  try {
    await enforceRateLimit({
      key: `webhook:whatsapp:${clientIp(request)}`,
      ...RATE_LIMITS.webhook,
    });

    const rawBody = await request.text();
    const signature = request.headers.get("x-hub-signature-256");
    const result = await processWhatsAppWebhook(rawBody, signature);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof ApiError) {
      return jsonError(error);
    }
    console.error("whatsapp_webhook_failed");
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
});
