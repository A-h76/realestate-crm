import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/lib/db";
import { sendRetryPolicy, WhatsAppBusinessProvider } from "../../src/lib/providers/whatsapp/business";

const provider = new WhatsAppBusinessProvider();
const originalFetch = globalThis.fetch;
const originalEnv = {
  token: process.env.WHATSAPP_ACCESS_TOKEN,
  phoneId: process.env.WHATSAPP_PHONE_NUMBER_ID,
};

function mockFetch(handler: (url: string, init: RequestInit) => { status: number; body: unknown }) {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const { status, body } = handler(url, init);
    return new Response(JSON.stringify(body), { status }) as unknown as Response;
  }) as typeof fetch;
}

describe("WhatsAppBusinessProvider — Meta Cloud API send", () => {
  let workspaceId: string;
  let leadId: string;
  let leadNoPhoneId: string;

  before(async () => {
    const workspace = await prisma.workspace.create({
      data: { name: "WA Provider Test", slug: `wa-provider-test-${randomUUID()}` },
    });
    workspaceId = workspace.id;
    const lead = await prisma.lead.create({
      data: { workspaceId, firstName: "Ethan", whatsappNumber: "+14155550123" },
    });
    leadId = lead.id;
    const leadNoPhone = await prisma.lead.create({
      data: { workspaceId, firstName: "No Phone" },
    });
    leadNoPhoneId = leadNoPhone.id;
  });

  after(async () => {
    await prisma.workspace.delete({ where: { id: workspaceId } });
    globalThis.fetch = originalFetch;
    if (originalEnv.token !== undefined) process.env.WHATSAPP_ACCESS_TOKEN = originalEnv.token;
    else delete process.env.WHATSAPP_ACCESS_TOKEN;
    if (originalEnv.phoneId !== undefined) process.env.WHATSAPP_PHONE_NUMBER_ID = originalEnv.phoneId;
    else delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  });

  it("stores FAILED, never SENT, when credentials are not configured", async () => {
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    const message = await provider.sendMessage(workspaceId, {
      conversationId: `lead:${leadId}`,
      body: "hello",
      leadId,
    });
    assert.equal(message.status, "FAILED");
    assert.equal(message.externalId, null);
  });

  it("calls the Meta Graph API with the resolved phone and stores SENT + provider message id on success", async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "test-phone-id";
    let capturedUrl = "";
    let capturedAuth = "";
    let capturedBody: Record<string, unknown> = {};
    mockFetch((url, init) => {
      capturedUrl = url;
      capturedAuth = (init.headers as Record<string, string>).Authorization;
      capturedBody = JSON.parse(init.body as string);
      return { status: 200, body: { messages: [{ id: "wamid.OUT.1" }] } };
    });

    const message = await provider.sendMessage(workspaceId, {
      conversationId: `lead:${leadId}`,
      body: "Absolutely — we can set up a showing tomorrow at 4pm.",
      leadId,
    });

    assert.equal(message.status, "SENT");
    assert.equal(message.externalId, "wamid.OUT.1");
    assert.ok(capturedUrl.includes("test-phone-id"));
    assert.equal(capturedAuth, "Bearer test-token");
    assert.equal(capturedBody.to, "14155550123", "digits-only E.164 as the Cloud API expects");
    assert.equal((capturedBody.text as { body: string }).body, "Absolutely — we can set up a showing tomorrow at 4pm.");
  });

  it("stores FAILED with sanitized error metadata (no token) when Meta rejects the request", async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "test-phone-id";
    mockFetch(() => ({
      status: 401,
      body: { error: { message: "Invalid OAuth access token", code: 190 } },
    }));

    const errors: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    let message;
    try {
      message = await provider.sendMessage(workspaceId, {
        conversationId: `lead:${leadId}`,
        body: "hello",
        leadId,
      });
    } finally {
      console.error = originalError;
    }

    assert.equal(message.status, "FAILED");
    assert.equal(message.externalId, null);
    const metadata = message.metadata as Record<string, unknown>;
    assert.equal(metadata.errorCode, "190");
    assert.equal(metadata.httpStatus, 401);
    const loggedText = JSON.stringify(errors);
    assert.equal(loggedText.includes("test-token"), false);
  });

  it("does not call the Graph API and stores FAILED when the recipient has no WhatsApp number on file", async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "test-phone-id";
    let called = false;
    mockFetch(() => {
      called = true;
      return { status: 200, body: {} };
    });

    const message = await provider.sendMessage(workspaceId, {
      conversationId: `lead:${leadNoPhoneId}`,
      body: "hello",
      leadId: leadNoPhoneId,
    });

    assert.equal(called, false);
    assert.equal(message.status, "FAILED");
  });
});

/**
 * INTG-009: retries are bounded and only happen when the previous attempt provably did not reach WhatsApp.
 * Anything ambiguous (timeout, 5xx, dropped connection) is NOT retried, because the Cloud API has no idempotency key
 * and a retry could message the customer twice.
 */
describe("WhatsAppBusinessProvider: retry and failure classification", () => {
  let workspaceId: string;
  let leadId: string;
  const savedPolicy = { ...sendRetryPolicy };

  before(async () => {
    const workspace = await prisma.workspace.create({ data: { name: "WA Retry Test", slug: `wa-retry-test-${randomUUID()}` } });
    workspaceId = workspace.id;
    leadId = (await prisma.lead.create({ data: { workspaceId, firstName: "Retry", whatsappNumber: "+14155550124" } })).id;
    process.env.WHATSAPP_ACCESS_TOKEN = "retry-token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "retry-phone-id";
    sendRetryPolicy.baseDelayMs = 1;
    sendRetryPolicy.maxDelayMs = 20;
  });

  after(async () => {
    await prisma.workspace.delete({ where: { id: workspaceId } });
    Object.assign(sendRetryPolicy, savedPolicy);
    globalThis.fetch = originalFetch;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  });

  /** Plays the scripted outcomes in order; an Error is thrown, anything else is returned as a Response. */
  function script(steps: Array<Error | { status: number; body: unknown; headers?: Record<string, string> }>) {
    const calls = { n: 0 };
    globalThis.fetch = (async () => {
      const step = steps[Math.min(calls.n, steps.length - 1)];
      calls.n += 1;
      if (step instanceof Error) throw step;
      return new Response(JSON.stringify(step.body), { status: step.status, headers: step.headers }) as unknown as Response;
    }) as typeof fetch;
    return calls;
  }

  const send = async () => {
    const quiet = console.error;
    console.error = () => {};
    try {
      return await provider.sendMessage(workspaceId, { conversationId: `lead:${leadId}`, body: "hello", leadId });
    } finally {
      console.error = quiet;
    }
  };
  const meta = (m: { metadata: unknown }) => m.metadata as Record<string, unknown>;
  const OK = () => ({ status: 200, body: { messages: [{ id: `wamid.${randomUUID()}` }] } });
  const THROTTLED = { status: 429, body: { error: { message: "Too many requests", code: 130429 } }, headers: { "retry-after": "0" } };

  it("a 429 is retried and the eventual success is stored once as SENT", async () => {
    const calls = script([THROTTLED, OK()]);
    const before_ = await prisma.whatsAppMessage.count({ where: { workspaceId } });
    const message = await send();
    assert.equal(calls.n, 2);
    assert.equal(message.status, "SENT");
    assert.equal(meta(message).attempts, 2);
    assert.equal(await prisma.whatsAppMessage.count({ where: { workspaceId } }) - before_, 1, "one stored message, not one per attempt");
  });

  it("throttling that never clears stops after the maximum attempts and is stored FAILED / rate_limited", async () => {
    const calls = script([THROTTLED]);
    const message = await send();
    assert.equal(calls.n, sendRetryPolicy.maxAttempts);
    assert.equal(message.status, "FAILED");
    assert.equal(meta(message).failureKind, "rate_limited");
    assert.equal(meta(message).deliveryUnknown, false, "a throttled request was rejected, so it is known not to have been sent");
  });

  it("a Meta throttling error code is retried even on a non-429 status", async () => {
    const calls = script([{ status: 400, body: { error: { message: "Rate limit issues", code: 80007 } } }, OK()]);
    assert.equal((await send()).status, "SENT");
    assert.equal(calls.n, 2);
  });

  it("a timeout is NOT retried (it may have been delivered) and is flagged deliveryUnknown", async () => {
    const calls = script([Object.assign(new Error("aborted"), { name: "AbortError" })]);
    const message = await send();
    assert.equal(calls.n, 1);
    assert.equal(message.status, "FAILED");
    assert.equal(meta(message).failureKind, "delivery_unknown");
    assert.equal(meta(message).deliveryUnknown, true);
    assert.equal(meta(message).errorCode, "timeout");
  });

  it("a 5xx is NOT retried and is flagged deliveryUnknown", async () => {
    const calls = script([{ status: 503, body: { error: { message: "Service unavailable", code: 2 } } }, OK()]);
    const message = await send();
    assert.equal(calls.n, 1);
    assert.equal(meta(message).deliveryUnknown, true);
  });

  it("a connection dropped mid-request is NOT retried", async () => {
    const calls = script([new TypeError("fetch failed", { cause: { code: "ECONNRESET" } }), OK()]);
    const message = await send();
    assert.equal(calls.n, 1);
    assert.equal(meta(message).deliveryUnknown, true);
  });

  it("a connection that never opened (refused / DNS) is retried, because nothing was sent", async () => {
    const calls = script([new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }), OK()]);
    const message = await send();
    assert.equal(calls.n, 2);
    assert.equal(message.status, "SENT");
  });

  it("an unreachable Meta that never recovers is FAILED / unreachable, not deliveryUnknown, after bounded attempts", async () => {
    const calls = script([new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } })]);
    const message = await send();
    assert.equal(calls.n, sendRetryPolicy.maxAttempts);
    assert.equal(meta(message).failureKind, "unreachable");
    assert.equal(meta(message).deliveryUnknown, false);
  });

  it("permanent rejections (bad token, invalid number, outside the 24h window) are never retried", async () => {
    for (const [status, code] of [[401, 190], [400, 131030], [400, 131047]] as const) {
      const calls = script([{ status, body: { error: { message: "rejected", code } } }, OK()]);
      const message = await send();
      assert.equal(calls.n, 1, String(code));
      assert.equal(meta(message).failureKind, "permanent", String(code));
      assert.equal(meta(message).deliveryUnknown, false);
    }
  });

  it("a 200 without a message id is ambiguous: not retried, deliveryUnknown", async () => {
    const calls = script([{ status: 200, body: {} }, OK()]);
    const message = await send();
    assert.equal(calls.n, 1);
    assert.equal(message.status, "FAILED");
    assert.equal(meta(message).deliveryUnknown, true);
  });
});
