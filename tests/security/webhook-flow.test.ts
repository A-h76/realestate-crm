import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/lib/db";
import { processWhatsAppWebhook } from "../../src/lib/webhooks/whatsapp";

const SECRET = "wa-flow-test-secret";

function sign(raw: string) {
  return `sha256=${createHmac("sha256", SECRET).update(raw, "utf8").digest("hex")}`;
}

function textMessagePayload(opts: {
  phoneNumberId: string;
  waId: string;
  name?: string;
  id: string;
  body: string;
}) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: opts.phoneNumberId },
              contacts: opts.name ? [{ wa_id: opts.waId, profile: { name: opts.name } }] : [],
              messages: [{ from: opts.waId, id: opts.id, type: "text", text: { body: opts.body } }],
            },
          },
        ],
      },
    ],
  };
}

function unsupportedMessagePayload(opts: { phoneNumberId: string; waId: string; id: string; type: string }) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: opts.phoneNumberId },
              messages: [{ from: opts.waId, id: opts.id, type: opts.type }],
            },
          },
        ],
      },
    ],
  };
}

function statusPayload(opts: { phoneNumberId: string; id: string; status: string }) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: opts.phoneNumberId },
              statuses: [{ id: opts.id, status: opts.status }],
            },
          },
        ],
      },
    ],
  };
}

describe("WhatsApp webhook — end-to-end inbound flow", () => {
  let workspaceId: string;
  let phoneNumberId: string;
  const waId = "923001234567";
  const e164 = "+923001234567";

  before(async () => {
    process.env.WHATSAPP_APP_SECRET = SECRET;
    const workspace = await prisma.workspace.create({
      data: { name: "WA Flow Test", slug: `wa-flow-test-${randomUUID()}` },
    });
    workspaceId = workspace.id;
    phoneNumberId = `phone-${randomUUID()}`;
    await prisma.whatsAppIntegration.create({
      data: { workspaceId, phoneNumberId, enabled: true },
    });
  });

  after(async () => {
    await prisma.workspace.delete({ where: { id: workspaceId } });
  });

  it("creates a Lead for an unknown WhatsApp number, persists the message, and extracts requirements", async () => {
    const raw = JSON.stringify(
      textMessagePayload({
        phoneNumberId,
        waId,
        name: "Ahmed Khan",
        id: "wamid.1",
        body: "5 marla house DHA 2 mein rent pe chahiye 80k tak",
      }),
    );
    const result = await processWhatsAppWebhook(raw, sign(raw));
    assert.equal(result.status, "stored");

    const lead = await prisma.lead.findFirst({ where: { workspaceId, whatsappNumber: e164 } });
    assert.ok(lead);
    assert.equal(lead!.source, "WHATSAPP_INBOUND");
    assert.equal(lead!.firstName, "Ahmed");
    assert.equal(lead!.lastName, "Khan");
    assert.equal(lead!.preferredArea, "DHA Phase 2");
    assert.equal(lead!.propertyPurpose, "RENT");
    assert.equal(Number(lead!.budgetMax), 80000);

    const message = await prisma.whatsAppMessage.findFirst({ where: { workspaceId, externalId: "wamid.1" } });
    assert.ok(message);
    assert.equal(message!.direction, "INBOUND");
    assert.equal(message!.leadId, lead!.id);
  });

  it("is idempotent under duplicate delivery of the same Meta message id", async () => {
    const raw = JSON.stringify(
      textMessagePayload({
        phoneNumberId,
        waId,
        name: "Ahmed Khan",
        id: "wamid.1",
        body: "5 marla house DHA 2 mein rent pe chahiye 80k tak",
      }),
    );
    const result = await processWhatsAppWebhook(raw, sign(raw));
    assert.equal(result.status, "duplicate");

    const messageCount = await prisma.whatsAppMessage.count({ where: { workspaceId, externalId: "wamid.1" } });
    assert.equal(messageCount, 1);
    const leadCount = await prisma.lead.count({ where: { workspaceId, whatsappNumber: e164 } });
    assert.equal(leadCount, 1);
  });

  it("known lead: a later message fills only currently-blank fields, never overwrites confirmed ones", async () => {
    const raw = JSON.stringify(
      textMessagePayload({ phoneNumberId, waId, name: "Ahmed Khan", id: "wamid.2", body: "budget 100k tak, 3 bed chahiye" }),
    );
    const result = await processWhatsAppWebhook(raw, sign(raw));
    assert.equal(result.status, "stored");

    const lead = await prisma.lead.findFirst({ where: { workspaceId, whatsappNumber: e164 } });
    // budgetMax was already confirmed at 80000 — a later, different figure must not overwrite it.
    assert.equal(Number(lead!.budgetMax), 80000);
    // bedroomPref was blank — this message fills it.
    assert.equal(lead!.bedroomPref, 3);

    const leadCount = await prisma.lead.count({ where: { workspaceId, whatsappNumber: e164 } });
    assert.equal(leadCount, 1, "known number must update the existing lead, not create a second one");
  });

  it("triggers exactly one human handoff task on a site-visit request, even under retry", async () => {
    const raw = JSON.stringify(
      textMessagePayload({ phoneNumberId, waId, name: "Ahmed Khan", id: "wamid.3", body: "kal property dekh sakte hain?" }),
    );
    await processWhatsAppWebhook(raw, sign(raw));

    const lead = await prisma.lead.findFirst({ where: { workspaceId, whatsappNumber: e164 } });
    // Filtered to this reason specifically: the lead's full requirement was already
    // known with no seeded inventory to match, so it also carries a separate
    // NO_GROUNDED_INVENTORY_MATCH handoff (P0 #6.1) — a different, expected task.
    const tasks = await prisma.task.findMany({
      where: { workspaceId, leadId: lead!.id, description: { contains: "[handoff:SITE_VISIT_REQUESTED]" } },
    });
    assert.equal(tasks.length, 1);
    assert.match(tasks[0].description!, /SITE_VISIT_REQUESTED/);

    // A second, unrelated message must not create a duplicate open handoff for the same reason.
    const raw2 = JSON.stringify(
      textMessagePayload({ phoneNumberId, waId, name: "Ahmed Khan", id: "wamid.3b", body: "theek hai" }),
    );
    await processWhatsAppWebhook(raw2, sign(raw2));
    const tasksAfter = await prisma.task.findMany({
      where: { workspaceId, leadId: lead!.id, description: { contains: "[handoff:SITE_VISIT_REQUESTED]" } },
    });
    assert.equal(tasksAfter.length, 1);
  });

  it("also hands off the very first message when the full requirement matches no seeded inventory", async () => {
    const lead = await prisma.lead.findFirst({ where: { workspaceId, whatsappNumber: e164 } });
    const task = await prisma.task.findFirst({
      where: { workspaceId, leadId: lead!.id, description: { contains: "[handoff:NO_GROUNDED_INVENTORY_MATCH]" } },
    });
    assert.ok(task, "no property was seeded for this workspace, so the first fully-qualified message must hand off rather than silently finding nothing");
  });

  it("persists an unsupported message type (e.g. image) without crashing or running extraction/handoff", async () => {
    const raw = JSON.stringify(unsupportedMessagePayload({ phoneNumberId, waId, id: "wamid.4", type: "image" }));
    const result = await processWhatsAppWebhook(raw, sign(raw));
    assert.equal(result.status, "stored");

    const message = await prisma.whatsAppMessage.findFirst({ where: { workspaceId, externalId: "wamid.4" } });
    assert.ok(message);
    assert.match(message!.body, /image/i);
    assert.equal((message!.metadata as Record<string, unknown>).unsupportedType, "image");

    // Still resolves to the same known lead, doesn't fork a new one.
    const leadCount = await prisma.lead.count({ where: { workspaceId, whatsappNumber: e164 } });
    assert.equal(leadCount, 1);
  });

  it("updates an outbound message's status from a Meta delivery-status webhook", async () => {
    const lead = await prisma.lead.findFirst({ where: { workspaceId, whatsappNumber: e164 } });
    const outbound = await prisma.whatsAppMessage.create({
      data: {
        workspaceId,
        conversationId: `lead:${lead!.id}`,
        direction: "OUTBOUND",
        body: "Ji bilkul, kal 4 baje visit arrange kar sakte hain.",
        status: "SENT",
        provider: "whatsapp-business",
        externalId: "wamid.out.1",
        leadId: lead!.id,
      },
    });

    const raw = JSON.stringify(statusPayload({ phoneNumberId, id: "wamid.out.1", status: "delivered" }));
    await processWhatsAppWebhook(raw, sign(raw));

    const updated = await prisma.whatsAppMessage.findUnique({ where: { id: outbound.id } });
    assert.equal(updated!.status, "DELIVERED");
  });
});
