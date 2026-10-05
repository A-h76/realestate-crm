import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/lib/db";
import {
  processWhatsAppWebhook,
  recoverStalledWebhookEvents,
  WEBHOOK_RECOVERY_MAX_ATTEMPTS,
} from "../../src/lib/webhooks/whatsapp";

const SECRET = "webhook-recovery-secret";

describe("webhook recovery: a crash after the claim commits does not lose the customer's turn", () => {
  let workspaceId: string;
  let phoneNumberId: string;
  let agentId: string;

  before(async () => {
    process.env.WHATSAPP_APP_SECRET = SECRET;
    const ws = await prisma.workspace.create({ data: { name: "Recovery", slug: `recovery-${randomUUID()}` } });
    workspaceId = ws.id;
    phoneNumberId = `phone-${randomUUID()}`;
    await prisma.whatsAppIntegration.create({ data: { workspaceId, phoneNumberId, enabled: true } });
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.test`, name: "Agent", passwordHash: "x" } });
    agentId = user.id;
    await prisma.workspaceMember.create({ data: { workspaceId, userId: agentId, role: "AGENT" } });
  });

  after(async () => {
    await prisma.workspace.delete({ where: { id: workspaceId } });
    await prisma.user.delete({ where: { id: agentId } });
  });

  async function receive(id: string, from: string, body: string) {
    const raw = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, messages: [{ from, id, type: "text", text: { body } }] } }] }],
    });
    return processWhatsAppWebhook(raw, `sha256=${createHmac("sha256", SECRET).update(raw, "utf8").digest("hex")}`);
  }

  /** Puts the event back in the state a crash right after the claim+message commit would have left it. */
  async function simulateCrash(externalId: string, leadId: string) {
    await prisma.whatsAppMessage.deleteMany({ where: { workspaceId, leadId, direction: "OUTBOUND" } });
    await prisma.auditLog.deleteMany({ where: { workspaceId, action: "WHATSAPP_MESSAGE_LOGGED" } });
    await prisma.notification.deleteMany({ where: { workspaceId, type: "WHATSAPP_RECEIVED" } });
    await prisma.webhookEvent.updateMany({
      where: { provider: "whatsapp", externalEventId: externalId },
      data: { processedAt: null, attempts: 0, createdAt: new Date(Date.now() - 10 * 60_000) },
    });
  }

  it("a normally processed event is stamped and the sweep leaves it alone", async () => {
    await receive("wamid.rec.ok", "14155550201", "hi, looking for a 3 bedroom");
    const event = await prisma.webhookEvent.findFirstOrThrow({ where: { externalEventId: "wamid.rec.ok" } });
    assert.ok(event.processedAt);
    const result = await recoverStalledWebhookEvents({ workspaceId });
    assert.deepEqual(result, { redriven: 0, failed: 0, exhausted: 0 });
  });

  it("re-drives the lost post-commit steps once, and a second sweep does nothing more", async () => {
    await receive("wamid.rec.crash", "14155550202", "hi, looking for a 3 bedroom");
    const lead = await prisma.lead.findFirstOrThrow({ where: { workspaceId, whatsappNumber: "+14155550202" } });
    await simulateCrash("wamid.rec.crash", lead.id);
    // Meta's retry is still swallowed by the claim, which is exactly why the sweep exists.
    assert.equal((await receive("wamid.rec.crash", "14155550202", "hi, looking for a 3 bedroom")).status, "duplicate");

    const first = await recoverStalledWebhookEvents({ workspaceId });
    assert.equal(first.redriven, 1);
    const event = await prisma.webhookEvent.findFirstOrThrow({ where: { externalEventId: "wamid.rec.crash" } });
    assert.ok(event.processedAt);
    assert.equal(event.attempts, 1);
    const inbound = await prisma.whatsAppMessage.findFirstOrThrow({ where: { workspaceId, leadId: lead.id, direction: "INBOUND" } });
    assert.equal(await prisma.auditLog.count({ where: { workspaceId, action: "WHATSAPP_MESSAGE_LOGGED", entityId: inbound.id } }), 1);
    assert.equal(await prisma.notification.count({ where: { workspaceId, userId: agentId, type: "WHATSAPP_RECEIVED" } }), 1);
    const replies = await prisma.whatsAppMessage.count({ where: { workspaceId, leadId: lead.id, direction: "OUTBOUND" } });
    assert.equal(replies, 1, "the customer's turn is answered (as a draft in the default mode)");

    assert.deepEqual(await recoverStalledWebhookEvents({ workspaceId }), { redriven: 0, failed: 0, exhausted: 0 });
  });

  it("does not answer a second time when a reply already exists after the inbound", async () => {
    await receive("wamid.rec.answered", "14155550203", "hello, budget 400k");
    const lead = await prisma.lead.findFirstOrThrow({ where: { workspaceId, whatsappNumber: "+14155550203" } });
    const before = await prisma.whatsAppMessage.count({ where: { workspaceId, leadId: lead.id, direction: "OUTBOUND" } });
    assert.ok(before >= 1);
    await prisma.webhookEvent.updateMany({
      where: { externalEventId: "wamid.rec.answered" },
      data: { processedAt: null, createdAt: new Date(Date.now() - 10 * 60_000) },
    });
    await recoverStalledWebhookEvents({ workspaceId });
    assert.equal(await prisma.whatsAppMessage.count({ where: { workspaceId, leadId: lead.id, direction: "OUTBOUND" } }), before);
  });

  it("an opt-out replay does not revoke a later opt-in", async () => {
    await receive("wamid.rec.stop", "14155550204", "STOP");
    const lead = await prisma.lead.findFirstOrThrow({ where: { workspaceId, whatsappNumber: "+14155550204" } });
    await prisma.messagingConsent.updateMany({ where: { workspaceId, leadId: lead.id }, data: { status: "GRANTED", revokedAt: null, capturedAt: new Date(Date.now() + 1000) } });
    await prisma.webhookEvent.updateMany({
      where: { externalEventId: "wamid.rec.stop" },
      data: { processedAt: null, createdAt: new Date(Date.now() - 10 * 60_000) },
    });
    await recoverStalledWebhookEvents({ workspaceId });
    const consent = await prisma.messagingConsent.findFirstOrThrow({ where: { workspaceId, leadId: lead.id } });
    assert.equal(consent.status, "GRANTED");
  });

  it("stops after the attempt bound and reports the event as exhausted", async () => {
    await receive("wamid.rec.exhaust", "14155550205", "hi");
    await prisma.webhookEvent.updateMany({
      where: { externalEventId: "wamid.rec.exhaust" },
      data: { processedAt: null, attempts: WEBHOOK_RECOVERY_MAX_ATTEMPTS, createdAt: new Date(Date.now() - 10 * 60_000) },
    });
    const result = await recoverStalledWebhookEvents({ workspaceId });
    assert.equal(result.exhausted, 1);
    assert.equal(result.redriven, 0);
    assert.equal((await prisma.webhookEvent.findFirstOrThrow({ where: { externalEventId: "wamid.rec.exhaust" } })).processedAt, null);
  });
});
