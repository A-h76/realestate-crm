import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/lib/db";
import { processWhatsAppWebhook } from "../../src/lib/webhooks/whatsapp";

const SECRET = "intake-ownership-secret";

function inbound(phoneNumberId: string, waId: string, id: string, body: string) {
  const raw = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, messages: [{ from: waId, id, type: "text", text: { body } }] } }] }],
  });
  return processWhatsAppWebhook(raw, `sha256=${createHmac("sha256", SECRET).update(raw, "utf8").digest("hex")}`);
}

async function workspaceWithIntegration(withAgent: boolean) {
  const ws = await prisma.workspace.create({ data: { name: "Intake", slug: `intake-${randomUUID()}` } });
  const phoneNumberId = `phone-${randomUUID()}`;
  await prisma.whatsAppIntegration.create({ data: { workspaceId: ws.id, phoneNumberId, enabled: true } });
  let agentId: string | null = null;
  if (withAgent) {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.test`, name: "Agent A", passwordHash: "x" } });
    await prisma.workspaceMember.create({ data: { workspaceId: ws.id, userId: user.id, role: "AGENT" } });
    agentId = user.id;
  }
  return { ws, phoneNumberId, agentId };
}

describe("system intake never leaves a lead unowned", () => {
  const created: string[] = [];
  before(() => {
    process.env.WHATSAPP_APP_SECRET = SECRET;
  });
  after(async () => {
    for (const id of created) await prisma.workspace.delete({ where: { id } });
  });

  it("assigns an agent, attaches the first-contact task and notification to them, and stamps lastActivityAt", async () => {
    const { ws, phoneNumberId, agentId } = await workspaceWithIntegration(true);
    created.push(ws.id);
    await prisma.automation.create({
      data: { workspaceId: ws.id, name: "t", trigger: "LEAD_CREATED", actions: [{ type: "CREATE_TASK", title: "Contact new lead" }] },
    });
    await inbound(phoneNumberId, "14155550199", "wamid.own.1", "hello");

    const lead = await prisma.lead.findFirstOrThrow({ where: { workspaceId: ws.id } });
    assert.equal(lead.ownerId, agentId);
    assert.ok(lead.lastActivityAt, "inbound message counts as activity");
    const task = await prisma.task.findFirstOrThrow({ where: { workspaceId: ws.id, leadId: lead.id } });
    assert.equal(task.ownerId, agentId);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { workspaceId: ws.id, action: "LEAD_CREATED", entityId: lead.id } });
    assert.equal((audit.metadata as { reason?: string }).reason, "intake_auto_assign");
  });

  it("a later inbound message refreshes lastActivityAt", async () => {
    const { ws, phoneNumberId } = await workspaceWithIntegration(true);
    created.push(ws.id);
    await inbound(phoneNumberId, "14155550198", "wamid.own.2", "hi");
    const lead = await prisma.lead.findFirstOrThrow({ where: { workspaceId: ws.id } });
    await prisma.lead.update({ where: { id: lead.id }, data: { lastActivityAt: new Date(Date.now() - 30 * 86400000) } });
    await inbound(phoneNumberId, "14155550198", "wamid.own.3", "still looking");
    const after = await prisma.lead.findFirstOrThrow({ where: { id: lead.id } });
    assert.ok(Date.now() - after.lastActivityAt!.getTime() < 60_000);
  });

  it("with no agents the lead stays unowned (surfaced by the unassigned attention rule), not an error", async () => {
    const { ws, phoneNumberId } = await workspaceWithIntegration(false);
    created.push(ws.id);
    await inbound(phoneNumberId, "14155550197", "wamid.own.4", "hello");
    const lead = await prisma.lead.findFirstOrThrow({ where: { workspaceId: ws.id } });
    assert.equal(lead.ownerId, null);
  });
});
