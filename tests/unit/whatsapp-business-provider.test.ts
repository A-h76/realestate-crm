import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/lib/db";
import { WhatsAppBusinessProvider } from "../../src/lib/providers/whatsapp/business";

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
      data: { workspaceId, firstName: "Ahmed", whatsappNumber: "+923001234567" },
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
      body: "Ji bilkul, kal 4 baje visit arrange kar sakte hain.",
      leadId,
    });

    assert.equal(message.status, "SENT");
    assert.equal(message.externalId, "wamid.OUT.1");
    assert.ok(capturedUrl.includes("test-phone-id"));
    assert.equal(capturedAuth, "Bearer test-token");
    assert.equal(capturedBody.to, "923001234567");
    assert.equal((capturedBody.text as { body: string }).body, "Ji bilkul, kal 4 baje visit arrange kar sakte hain.");
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
