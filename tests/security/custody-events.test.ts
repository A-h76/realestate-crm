import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/lib/db";
import { markFirstContact } from "../../src/lib/leads/custody";
import { writeAudit } from "../../src/lib/audit";
import { processWhatsAppWebhook } from "../../src/lib/webhooks/whatsapp";

const SECRET = "custody-events-secret";

describe("custody timestamps and verifiable audit events", () => {
  let workspaceId: string;
  let phoneNumberId: string;
  let agentId: string;

  before(async () => {
    process.env.WHATSAPP_APP_SECRET = SECRET;
    const ws = await prisma.workspace.create({ data: { name: "Custody", slug: `custody-${randomUUID()}` } });
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

  it("inbound intake stamps assignedAt and records a CUSTOMER event carrying the provider message id", async () => {
    const raw = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, messages: [{ from: "14155550177", id: "wamid.cust.1", type: "text", text: { body: "hello" } }] } }] }],
    });
    await processWhatsAppWebhook(raw, `sha256=${createHmac("sha256", SECRET).update(raw, "utf8").digest("hex")}`);

    const lead = await prisma.lead.findFirstOrThrow({ where: { workspaceId } });
    assert.equal(lead.ownerId, agentId);
    assert.ok(lead.assignedAt);
    assert.equal(lead.firstContactAt, null, "a customer message is not outreach to the customer");

    const event = await prisma.auditLog.findFirstOrThrow({ where: { workspaceId, action: "WHATSAPP_MESSAGE_LOGGED" } });
    assert.equal(event.actorType, "CUSTOMER");
    assert.equal(event.providerEventId, "wamid.cust.1");
  });

  it("first contact is recorded exactly once; later touches never overwrite it", async () => {
    const lead = await prisma.lead.findFirstOrThrow({ where: { workspaceId } });
    const first = new Date(Date.now() + 1000);
    const [a, b] = await Promise.all([
      markFirstContact({ workspaceId, leadId: lead.id, at: first, actorId: agentId, actorType: "USER", via: "test" }),
      markFirstContact({ workspaceId, leadId: lead.id, at: new Date(Date.now() + 5000), actorType: "AI", via: "test" }),
    ]);
    assert.equal([a, b].filter(Boolean).length, 1, "exactly one concurrent caller wins");
    const stamped = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    assert.ok(stamped.firstContactAt);
    assert.equal(await markFirstContact({ workspaceId, leadId: lead.id, actorType: "USER", via: "later" }), false);
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).firstContactAt!.getTime(), stamped.firstContactAt!.getTime());
    const events = await prisma.auditLog.findMany({ where: { workspaceId, action: "LEAD_FIRST_CONTACT", entityId: lead.id } });
    assert.equal(events.length, 1);
  });

  it("never stamps contact for a lead in another workspace", async () => {
    const lead = await prisma.lead.findFirstOrThrow({ where: { workspaceId } });
    const other = await prisma.workspace.create({ data: { name: "Other", slug: `other-${randomUUID()}` } });
    try {
      await prisma.lead.update({ where: { id: lead.id }, data: { firstContactAt: null } });
      assert.equal(await markFirstContact({ workspaceId: other.id, leadId: lead.id, actorType: "USER", via: "x" }), false);
      assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).firstContactAt, null);
    } finally {
      await prisma.workspace.delete({ where: { id: other.id } });
    }
  });

  it("writeAudit defaults the actor type from the actor and keeps explicit state transitions", async () => {
    const lead = await prisma.lead.findFirstOrThrow({ where: { workspaceId } });
    const system = await writeAudit({ workspaceId, action: "LEAD_UPDATED", entity: "Lead", entityId: lead.id });
    const user = await writeAudit({ workspaceId, actorId: agentId, action: "LEAD_STAGE_CHANGED", entity: "Lead", entityId: lead.id, fromState: "NEW", toState: "CONTACTED" });
    assert.equal(system.actorType, "SYSTEM");
    assert.equal(user.actorType, "USER");
    assert.deepEqual([user.fromState, user.toState], ["NEW", "CONTACTED"]);
  });
});
