import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/lib/db";
import { auditOutboundBlock, authorizeOutbound, inQuietHours } from "../../src/lib/messaging/outbound-gate";
import { recordConsent } from "../../src/lib/messaging/consent";
import { processWhatsAppWebhook } from "../../src/lib/webhooks/whatsapp";

/**
 * Outbound gate, timing rules: quiet hours in the recipient's local time and a per-recipient cap on automated
 * messages. Every case passes an explicit `now` so nothing depends on the wall clock. Workspace timezone is
 * America/New_York; the default quiet window is 21:00-08:00 local and the default cap is 3 per rolling 24h.
 */
describe("outbound gate: quiet hours and frequency cap", () => {
  let workspaceId: string;
  let humanUserId: string;
  const created: string[] = [];

  // 2026-10-08 is during US daylight time: ET = UTC-4, PT = UTC-7.
  const at = (utc: string) => new Date(`2026-10-08T${utc}:00Z`);
  const ET_NOON = at("16:00"); // 12:00 ET, 09:00 PT
  const ET_2230 = at("02:30"); // 22:30 ET (Oct 7), 19:30 PT
  const ET_0759 = at("11:59"); // 07:59 ET
  const ET_0800 = at("12:00"); // 08:00 ET, 05:00 PT
  const ET_2100 = at("01:00"); // 21:00 ET (Oct 7)

  const newLead = async () => {
    const number = `+1415555${String(Math.floor(1000 + Math.random() * 8999))}`;
    const lead = await prisma.lead.create({ data: { workspaceId, firstName: "Timing", lastName: randomUUID().slice(0, 8), whatsappNumber: number } });
    return { id: lead.id, number };
  };
  const grant = (number: string, timezone?: string) =>
    recordConsent({ workspaceId, channel: "WHATSAPP", rawAddress: number, status: "GRANTED", source: "test" }).then(() =>
      timezone ? prisma.messagingConsent.updateMany({ where: { workspaceId, address: number }, data: { timezone } }) : null,
    );
  const authorize = (leadId: string, number: string, intent: "HUMAN" | "AI" | "MARKETING", now: Date) =>
    authorizeOutbound({ workspaceId, leadId, channel: "WHATSAPP", intent, recipientAddress: number, now });
  const outbound = (leadId: string, data: { senderId?: string | null; status?: "SENT" | "DRAFT" | "FAILED"; ageHours?: number } = {}) =>
    prisma.whatsAppMessage.create({
      data: {
        workspaceId,
        conversationId: `lead:${leadId}`,
        direction: "OUTBOUND",
        body: "x",
        status: data.status ?? "SENT",
        leadId,
        senderId: data.senderId ?? null,
        provider: "whatsapp-business",
        sentAt: new Date(ET_NOON.getTime() - (data.ageHours ?? 1) * 3_600_000),
      },
    });

  before(async () => {
    const ws = await prisma.workspace.create({ data: { name: "Timing", slug: `timing-${randomUUID()}`, aiMode: "AUTO" } });
    workspaceId = ws.id;
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.test`, name: "Human", passwordHash: "x" } });
    humanUserId = user.id;
    created.push(user.id);
  });
  after(async () => {
    await prisma.workspace.delete({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { id: { in: created } } });
  });

  describe("inQuietHours", () => {
    it("handles a window that wraps midnight, one that does not, and 'off'", () => {
      assert.equal(inQuietHours(22 * 60, 21 * 60, 8 * 60), true);
      assert.equal(inQuietHours(3 * 60, 21 * 60, 8 * 60), true);
      assert.equal(inQuietHours(8 * 60, 21 * 60, 8 * 60), false, "end is exclusive");
      assert.equal(inQuietHours(21 * 60, 21 * 60, 8 * 60), true, "start is inclusive");
      assert.equal(inQuietHours(12 * 60, 21 * 60, 8 * 60), false);
      assert.equal(inQuietHours(13 * 60, 12 * 60, 14 * 60), true);
      assert.equal(inQuietHours(15 * 60, 12 * 60, 14 * 60), false);
      assert.equal(inQuietHours(0, 0, 0), false);
    });
  });

  describe("quiet hours", () => {
    it("blocks AI and MARKETING at night in the workspace timezone and allows them by day, at the exact boundaries", async () => {
      const { id, number } = await newLead();
      await grant(number);
      for (const intent of ["AI", "MARKETING"] as const) {
        assert.deepEqual(await authorize(id, number, intent, ET_NOON), { allowed: true }, `${intent} at noon`);
        const night = await authorize(id, number, intent, ET_2230);
        assert.equal(!night.allowed && night.reason, "quiet_hours", `${intent} at 22:30`);
        assert.equal((await authorize(id, number, intent, ET_2100)).allowed, false, `${intent} 21:00 is inside`);
        assert.equal((await authorize(id, number, intent, ET_0759)).allowed, false, `${intent} 07:59 is inside`);
        assert.equal((await authorize(id, number, intent, ET_0800)).allowed, true, `${intent} 08:00 is outside`);
      }
    });

    it("reports which timezone it used", async () => {
      const { id, number } = await newLead();
      await grant(number);
      const d = await authorize(id, number, "AI", ET_2230);
      assert.ok(!d.allowed);
      assert.deepEqual([d.detail?.timezone, d.detail?.timezoneSource], ["America/New_York", "workspace"]);
    });

    it("uses the recipient's own timezone when one is recorded, in both directions", async () => {
      // 22:30 ET but only 19:30 in Los Angeles: allowed for a Pacific recipient even though the workspace clock says night.
      const west = await newLead();
      await grant(west.number, "America/Los_Angeles");
      assert.equal((await authorize(west.id, west.number, "AI", ET_2230)).allowed, true);
      // 08:00 ET is fine for the workspace but 05:00 for a Pacific recipient: blocked, and the source says why.
      const d = await authorize(west.id, west.number, "AI", ET_0800);
      assert.ok(!d.allowed && d.reason === "quiet_hours");
      assert.deepEqual([d.detail?.timezone, d.detail?.timezoneSource], ["America/Los_Angeles", "recipient"]);
    });

    it("an unusable recorded timezone falls back to the workspace timezone instead of failing open or crashing", async () => {
      const { id, number } = await newLead();
      await grant(number, "Not/AZone");
      const d = await authorize(id, number, "AI", ET_2230);
      assert.ok(!d.allowed && d.reason === "quiet_hours");
      assert.equal(d.detail?.timezoneSource, "workspace");
    });

    it("quiet hours can be switched off per workspace (start = end)", async () => {
      const ws = await prisma.workspace.create({ data: { name: "NoQuiet", slug: `noquiet-${randomUUID()}`, quietHoursStartMin: 0, quietHoursEndMin: 0 } });
      try {
        const number = "+14155550199";
        await recordConsent({ workspaceId: ws.id, channel: "WHATSAPP", rawAddress: number, status: "GRANTED", source: "test" });
        const d = await authorizeOutbound({ workspaceId: ws.id, leadId: null, channel: "WHATSAPP", intent: "MARKETING", recipientAddress: number, now: ET_2230 });
        assert.equal(d.allowed, true);
      } finally {
        await prisma.workspace.delete({ where: { id: ws.id } });
      }
    });
  });

  describe("a human service reply is never held for timing", () => {
    it("is allowed in quiet hours and over the cap, but an opt-out still blocks it", async () => {
      const { id, number } = await newLead();
      for (let i = 0; i < 5; i++) await outbound(id);
      assert.deepEqual(await authorize(id, number, "HUMAN", ET_2230), { allowed: true });

      await recordConsent({ workspaceId, channel: "WHATSAPP", rawAddress: number, status: "REVOKED", source: "inbound_stop" });
      const d = await authorize(id, number, "HUMAN", ET_NOON);
      assert.equal(!d.allowed && d.reason, "consent_revoked");
    });

    it("an opt-out is reported as an opt-out, not as quiet hours, for automated sends at night", async () => {
      const { id, number } = await newLead();
      await recordConsent({ workspaceId, channel: "WHATSAPP", rawAddress: number, status: "REVOKED", source: "inbound_stop" });
      const d = await authorize(id, number, "AI", ET_2230);
      assert.equal(!d.allowed && d.reason, "consent_revoked");
    });
  });

  describe("frequency cap", () => {
    it("allows up to the cap of automated sends in 24h and blocks the next, for AI and MARKETING", async () => {
      const { id, number } = await newLead();
      await grant(number);
      for (let i = 0; i < 2; i++) await outbound(id);
      assert.equal((await authorize(id, number, "AI", ET_NOON)).allowed, true, "2 of 3 used");
      await outbound(id);
      for (const intent of ["AI", "MARKETING"] as const) {
        const d = await authorize(id, number, intent, ET_NOON);
        assert.ok(!d.allowed && d.reason === "frequency_cap", intent);
        assert.deepEqual([d.detail?.sent, d.detail?.cap, d.detail?.windowHours], [3, 3, 24]);
      }
    });

    it("counts only automated messages that actually went out, inside the window, to this recipient", async () => {
      const { id, number } = await newLead();
      const other = await newLead();
      await grant(number);
      await outbound(id, { senderId: humanUserId }); // a person wrote it
      await outbound(id, { status: "DRAFT" }); // never sent
      await outbound(id, { status: "FAILED" }); // never delivered
      await outbound(id, { ageHours: 30 }); // outside 24h
      for (let i = 0; i < 5; i++) await outbound(other.id); // someone else's thread
      assert.equal((await authorize(id, number, "AI", ET_NOON)).allowed, true);
    });

    it("the window rolls: the same messages stop counting once they age out", async () => {
      const { id, number } = await newLead();
      await grant(number);
      for (let i = 0; i < 3; i++) await outbound(id, { ageHours: 2 });
      assert.equal((await authorize(id, number, "AI", ET_NOON)).allowed, false);
      assert.equal((await authorize(id, number, "AI", new Date(ET_NOON.getTime() + 23 * 3_600_000))).allowed, true, "26h after they were sent");
    });
  });

  describe("audit", () => {
    it("records the reason and the detail of a timing block on the existing OUTBOUND_BLOCKED path", async () => {
      const { id, number } = await newLead();
      const d = await authorize(id, number, "AI", ET_2230);
      assert.ok(!d.allowed);
      await auditOutboundBlock({ workspaceId, leadId: id, intent: "AI", channel: "WHATSAPP", reason: d.reason, detail: d.detail });
      const row = await prisma.auditLog.findFirstOrThrow({ where: { workspaceId, action: "OUTBOUND_BLOCKED", entityId: id } });
      const meta = row.metadata as { reason: string; detail: { timezoneSource: string } };
      assert.equal(meta.reason, "quiet_hours");
      assert.equal(meta.detail.timezoneSource, "workspace");
    });
  });
});

describe("AI reply held by quiet hours is kept as a draft (end to end)", () => {
  const SECRET = "outbound-timing-secret";
  let workspaceId: string;
  const phoneNumberId = `phone-${randomUUID()}`;
  const waId = "14155550188";

  before(async () => {
    process.env.WHATSAPP_APP_SECRET = SECRET;
    delete process.env.OPENAI_API_KEY;
    delete process.env.WHATSAPP_BUSINESS_ENABLED;
    // 00:00-24:00 is always quiet, whatever time the suite runs.
    const ws = await prisma.workspace.create({
      data: { name: "Quiet e2e", slug: `quiet-e2e-${randomUUID()}`, aiMode: "AUTO", quietHoursStartMin: 0, quietHoursEndMin: 1440 },
    });
    workspaceId = ws.id;
    await prisma.whatsAppIntegration.create({ data: { workspaceId, phoneNumberId, enabled: true } });
  });
  after(async () => {
    await prisma.workspace.delete({ where: { id: workspaceId } });
  });

  it("sends nothing, saves the reply as a DRAFT for a human, and audits the block", async () => {
    const raw = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, contacts: [{ wa_id: waId, profile: { name: "Night Owl" } }], messages: [{ from: waId, id: `wamid.${randomUUID()}`, type: "text", text: { body: "Hi" } }] } }] }],
    });
    const sig = `sha256=${createHmac("sha256", SECRET).update(raw, "utf8").digest("hex")}`;
    assert.equal((await processWhatsAppWebhook(raw, sig)).status, "stored");

    const out = await prisma.whatsAppMessage.findMany({ where: { workspaceId, direction: "OUTBOUND" } });
    assert.equal(out.length, 1);
    assert.equal(out[0].status, "DRAFT", "held for a person, not sent and not lost");
    const block = await prisma.auditLog.findFirstOrThrow({ where: { workspaceId, action: "OUTBOUND_BLOCKED" } });
    assert.equal((block.metadata as { reason: string }).reason, "quiet_hours");
  });
});
