import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { verifyHubSignature256 } from "../../src/lib/security/hmac";
import { processWhatsAppWebhook } from "../../src/lib/webhooks/whatsapp";
import { ApiError } from "../../src/lib/errors";

describe("WhatsApp webhook signature", () => {
  it("rejects missing signatures", () => {
    assert.equal(verifyHubSignature256("{}", null, "secret"), false);
    assert.equal(verifyHubSignature256("{}", "", "secret"), false);
  });

  it("rejects invalid signatures", () => {
    assert.equal(verifyHubSignature256("{}", "sha256=deadbeef", "secret"), false);
  });

  it("accepts a valid HMAC-SHA256 of the raw body", () => {
    const raw = '{"object":"whatsapp_business_account"}';
    const digest = createHmac("sha256", "app-secret").update(raw, "utf8").digest("hex");
    assert.equal(verifyHubSignature256(raw, `sha256=${digest}`, "app-secret"), true);
  });

  it("does not parse JSON before signature failure", async () => {
    process.env.WHATSAPP_APP_SECRET = "app-secret";
    await assert.rejects(
      () => processWhatsAppWebhook("not-json", "sha256=nope"),
      (error: unknown) => error instanceof ApiError && error.status === 401,
    );
  });

  it("rejects unsigned webhook posts", async () => {
    process.env.WHATSAPP_APP_SECRET = "app-secret";
    await assert.rejects(
      () => processWhatsAppWebhook("{}", null),
      (error: unknown) => error instanceof ApiError && error.status === 401,
    );
  });

  it("fails closed when the app secret is missing", async () => {
    const previous = process.env.WHATSAPP_APP_SECRET;
    delete process.env.WHATSAPP_APP_SECRET;
    await assert.rejects(
      () => processWhatsAppWebhook("{}", "sha256=abc"),
      (error: unknown) => error instanceof ApiError && error.status === 503,
    );
    if (previous) process.env.WHATSAPP_APP_SECRET = previous;
  });

  it("rejects unknown phone_number_id after a valid signature", async () => {
    process.env.WHATSAPP_APP_SECRET = "app-secret";
    const raw = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "phone-not-mapped" },
                messages: [{ from: "923001234567", id: "wamid.unknown", type: "text", text: { body: "hi" } }],
              },
            },
          ],
        },
      ],
    });
    const digest = createHmac("sha256", "app-secret").update(raw, "utf8").digest("hex");
    await assert.rejects(
      () => processWhatsAppWebhook(raw, `sha256=${digest}`),
      (error: unknown) => error instanceof ApiError && error.status === 403,
    );
  });
});
