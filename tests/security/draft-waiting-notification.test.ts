import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/lib/db";
import { processWhatsAppWebhook } from "../../src/lib/webhooks/whatsapp";

const SECRET = "draft-waiting-secret";

describe("DRAFT mode tells the owner a reply is waiting", () => {
  let workspaceId: string;
  let phoneNumberId: string;
  let agentId: string;

  before(async () => {
    process.env.WHATSAPP_APP_SECRET = SECRET;
    const ws = await prisma.workspace.create({ data: { name: "Draft", slug: `draft-${randomUUID()}` } });
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

  it("a saved draft notifies the lead's owner exactly once, linking to the conversation", async () => {
    const raw = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, messages: [{ from: "14155550301", id: "wamid.draft.1", type: "text", text: { body: "hi, looking for a 3 bedroom" } }] } }] }],
    });
    await processWhatsAppWebhook(raw, `sha256=${createHmac("sha256", SECRET).update(raw, "utf8").digest("hex")}`);

    const lead = await prisma.lead.findFirstOrThrow({ where: { workspaceId } });
    const draft = await prisma.whatsAppMessage.findFirstOrThrow({ where: { workspaceId, leadId: lead.id, direction: "OUTBOUND", status: "DRAFT" } });
    const notes = await prisma.notification.findMany({ where: { workspaceId, type: "DRAFT_REPLY_WAITING" } });
    assert.equal(notes.length, 1);
    assert.equal(notes[0].userId, agentId);
    assert.equal(notes[0].dedupeKey, `draft-reply:${draft.id}`);
    assert.equal(notes[0].href, `/conversations?lead=${lead.id}`);
  });
});
