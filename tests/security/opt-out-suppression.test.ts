import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/lib/db";
import { processWhatsAppWebhook } from "../../src/lib/webhooks/whatsapp";
import { authorizeOutbound } from "../../src/lib/messaging/outbound-gate";

const SECRET = "opt-out-suppression-test-secret";

function sign(raw: string) {
  return `sha256=${createHmac("sha256", SECRET).update(raw, "utf8").digest("hex")}`;
}

function payload(opts: { phoneNumberId: string; waId: string; id: string; body: string }) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: opts.phoneNumberId },
              contacts: [{ wa_id: opts.waId, profile: { name: "Opt Out Tester" } }],
              messages: [{ from: opts.waId, id: opts.id, type: "text", text: { body: opts.body } }],
            },
          },
        ],
      },
    ],
  };
}

/**
 * An inbound STOP must suppress future messages to that number, through the real webhook path
 * — not merely be recognized by a pure function. The workspace here is in AUTO mode so that a
 * failure to suppress would actually produce a send, making the test meaningful.
 */
describe("inbound opt-out suppression (end to end)", () => {
  let workspaceId: string;
  let phoneNumberId: string;
  const waId = "14155550411";
  const e164 = "+14155550411";

  before(async () => {
    process.env.WHATSAPP_APP_SECRET = SECRET;
    delete process.env.WHATSAPP_BUSINESS_ENABLED;
    const workspace = await prisma.workspace.create({
      data: { name: "Opt Out Test", slug: `opt-out-test-${randomUUID()}`, aiMode: "AUTO", quietHoursStartMin: 0, quietHoursEndMin: 0, autoMessageCap: 1000 },
    });
    workspaceId = workspace.id;
    phoneNumberId = `phone-${randomUUID()}`;
    await prisma.whatsAppIntegration.create({ data: { workspaceId, phoneNumberId, enabled: true } });
    await prisma.property.create({
      data: {
        workspaceId,
        title: "2418 N Sawyer Ave — 3 Bed Townhouse",
        area: "Logan Square",
        city: "Chicago",
        state: "IL",
        postalCode: "60647",
        propertyType: "TOWNHOUSE",
        purpose: "RENT",
        size: 1650,
        sizeUnit: "SQFT",
        bedrooms: 3,
        price: 2_800,
        status: "AVAILABLE",
      },
    });
  });

  after(async () => {
    await prisma.workspace.delete({ where: { id: workspaceId } });
  });

  const send = async (id: string, body: string) => {
    const raw = JSON.stringify(payload({ phoneNumberId, waId, id, body }));
    return processWhatsAppWebhook(raw, sign(raw));
  };

  const lead = () => prisma.lead.findFirstOrThrow({ where: { workspaceId, whatsappNumber: e164 } });
  const outboundCount = async () =>
    prisma.whatsAppMessage.count({ where: { workspaceId, direction: "OUTBOUND", lead: { whatsappNumber: e164 } } });

  it("replies normally before any opt-out, so the suppression below is a real change in behavior", async () => {
    assert.equal((await send("wamid.optout.1", "Hi")).status, "stored");
    assert.ok((await outboundCount()) > 0, "AUTO mode replies to a greeting");
  });

  it("records REVOKED consent against the canonical number on an inbound STOP", async () => {
    assert.equal((await send("wamid.optout.2", "STOP")).status, "stored");
    const consent = await prisma.messagingConsent.findUniqueOrThrow({
      where: { workspaceId_channel_address: { workspaceId, channel: "WHATSAPP", address: e164 } },
    });
    assert.equal(consent.status, "REVOKED");
    assert.equal(consent.source, "inbound_stop");
    assert.ok(consent.revokedAt, "the revocation is timestamped");
  });

  it("does not reply to the STOP itself", async () => {
    const messages = await prisma.whatsAppMessage.findMany({
      where: { workspaceId, lead: { whatsappNumber: e164 } },
      orderBy: { sentAt: "asc" },
      select: { direction: true, body: true },
    });
    const last = messages.at(-1);
    assert.equal(last?.direction, "INBOUND");
    assert.equal(last?.body, "STOP", "nothing may be queued after the opt-out message");
  });

  it("stores the STOP message itself, so the opt-out is auditable", async () => {
    const stored = await prisma.whatsAppMessage.count({
      where: { workspaceId, externalId: "wamid.optout.2", direction: "INBOUND" },
    });
    assert.equal(stored, 1);
  });

  it("sends nothing further even when a new qualified inquiry arrives from that number", async () => {
    const before = await outboundCount();
    const result = await send("wamid.optout.3", "Actually, do you have 3 bedroom townhouses in Logan Square under $2,900?");
    assert.equal(result.status, "stored", "the inbound message is still recorded");
    assert.equal(await outboundCount(), before, "no automatic reply may be sent to an opted-out number");
  });

  it("refuses an AI send for that number at the authorization gate", async () => {
    const l = await lead();
    const decision = await authorizeOutbound({
      workspaceId,
      leadId: l.id,
      channel: "WHATSAPP",
      intent: "AI",
      recipientAddress: e164,
    });
    assert.equal(decision.allowed, false);
    assert.equal(!decision.allowed && decision.reason, "consent_revoked");
  });

  it("refuses a human send for that number too — an opt-out is not an AI-only restriction", async () => {
    const l = await lead();
    const decision = await authorizeOutbound({
      workspaceId,
      leadId: l.id,
      channel: "WHATSAPP",
      intent: "HUMAN",
      recipientAddress: e164,
    });
    assert.equal(decision.allowed, false);
    assert.equal(!decision.allowed && decision.reason, "consent_revoked");
  });

  it("records the refusal in the audit log rather than dropping it silently", async () => {
    const blocked = await prisma.auditLog.count({ where: { workspaceId, action: "OUTBOUND_BLOCKED" } });
    assert.ok(blocked > 0, "a suppressed automatic reply is audited");
  });

  it("does not treat a sentence merely containing 'stop' as an opt-out for a different number", async () => {
    const otherWaId = "14155550412";
    const raw = JSON.stringify(
      payload({ phoneNumberId, waId: otherWaId, id: "wamid.optout.4", body: "stop sending the Sawyer Ave one, send Spaulding instead" }),
    );
    assert.equal((await processWhatsAppWebhook(raw, sign(raw))).status, "stored");
    const consent = await prisma.messagingConsent.findUnique({
      where: { workspaceId_channel_address: { workspaceId, channel: "WHATSAPP", address: `+${otherWaId}` } },
    });
    assert.equal(consent, null, "a request to stop sending one listing is not a legal opt-out");
  });
});
