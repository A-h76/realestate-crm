import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/lib/db";
import { authorizeOutbound, lockConversationControl } from "../../src/lib/messaging/outbound-gate";
import { recordConsent } from "../../src/lib/messaging/consent";
import { takeOverLead } from "../../src/lib/leads/take-over";
import { createTenant, destroyTenant, installSessionMock, type Tenant } from "../helpers/http";

/**
 * P0 safety: nothing leaves the CRM unless the server says so, immediately before the send.
 *
 * Covers the three independent refusals in src/lib/messaging/outbound-gate.ts — human control,
 * AI mode, and consent — plus the take-over race the gate's advisory lock exists to close.
 * Real code and a real database; the decision itself is never mocked.
 */
describe("outbound authorization gate", () => {
  let t: Tenant;
  const phone = () => `+1415555${String(Math.floor(1000 + Math.random() * 8999))}`;

  before(async () => {
    installSessionMock();
    t = await createTenant("outbound-gate");
  });
  after(async () => {
    await destroyTenant(t);
  });

  const newLead = async (overrides: { ownerId?: string | null; whatsappNumber?: string } = {}) => {
    const number = overrides.whatsappNumber ?? phone();
    const lead = await prisma.lead.create({
      data: {
        workspaceId: t.workspaceId,
        firstName: "Gate",
        lastName: randomUUID().slice(0, 8),
        whatsappNumber: number,
        ownerId: overrides.ownerId ?? null,
      },
    });
    return { id: lead.id, number };
  };

  const setAiMode = (aiMode: "DRAFT" | "AUTO") =>
    prisma.workspace.update({ where: { id: t.workspaceId }, data: { aiMode } });

  const authorize = (leadId: string, number: string, intent: "HUMAN" | "AI" | "MARKETING") =>
    authorizeOutbound({
      workspaceId: t.workspaceId,
      leadId,
      channel: "WHATSAPP",
      intent,
      recipientAddress: number,
    });

  describe("AI mode", () => {
    it("refuses an AI send in DRAFT mode, which is the product default", async () => {
      await setAiMode("DRAFT");
      const { id, number } = await newLead();
      const decision = await authorize(id, number, "AI");
      assert.equal(decision.allowed, false);
      assert.equal(!decision.allowed && decision.reason, "ai_mode_draft");
    });

    it("allows an AI send only once the workspace explicitly opts into AUTO", async () => {
      await setAiMode("AUTO");
      const { id, number } = await newLead();
      assert.equal((await authorize(id, number, "AI")).allowed, true);
      await setAiMode("DRAFT");
    });

    it("does not gate a human send on AI mode", async () => {
      await setAiMode("DRAFT");
      const { id, number } = await newLead();
      assert.equal((await authorize(id, number, "HUMAN")).allowed, true);
    });
  });

  describe("consent", () => {
    it("blocks every intent, including a human reply, after an opt-out", async () => {
      await setAiMode("AUTO");
      const { id, number } = await newLead();
      await recordConsent({
        workspaceId: t.workspaceId,
        channel: "WHATSAPP",
        rawAddress: number,
        status: "REVOKED",
        source: "inbound_stop",
        leadId: id,
      });
      for (const intent of ["HUMAN", "AI", "MARKETING"] as const) {
        const decision = await authorize(id, number, intent);
        assert.equal(decision.allowed, false, intent);
        assert.equal(!decision.allowed && decision.reason, "consent_revoked", intent);
      }
      await setAiMode("DRAFT");
    });

    it("honors an opt-out however the number is later spelled", async () => {
      await setAiMode("AUTO");
      const national = `415555${String(Math.floor(1000 + Math.random() * 8999))}`;
      const { id } = await newLead({ whatsappNumber: `+1${national}` });
      await recordConsent({
        workspaceId: t.workspaceId,
        channel: "WHATSAPP",
        rawAddress: `+1${national}`,
        status: "REVOKED",
        source: "inbound_stop",
        leadId: id,
      });
      const area = national.slice(0, 3);
      for (const spelling of [`+1${national}`, national, `(${area}) ${national.slice(3, 6)}-${national.slice(6)}`]) {
        const decision = await authorize(id, spelling, "AI");
        assert.equal(!decision.allowed && decision.reason, "consent_revoked", spelling);
      }
      await setAiMode("DRAFT");
    });

    it("treats UNKNOWN consent as NOT consent for marketing", async () => {
      const { id, number } = await newLead();
      const decision = await authorize(id, number, "MARKETING");
      assert.equal(decision.allowed, false);
      assert.equal(!decision.allowed && decision.reason, "consent_not_granted");
    });

    it("allows marketing only after an explicit, recorded opt-in", async () => {
      const { id, number } = await newLead();
      await recordConsent({
        workspaceId: t.workspaceId,
        channel: "WHATSAPP",
        rawAddress: number,
        status: "GRANTED",
        source: "web_form",
        evidence: "https://example.test/contact",
        leadId: id,
      });
      assert.equal((await authorize(id, number, "MARKETING")).allowed, true);
    });

    it("refuses to send when the recipient has no usable number at all", async () => {
      const lead = await prisma.lead.create({
        data: { workspaceId: t.workspaceId, firstName: "NoPhone", whatsappNumber: "n/a" },
      });
      const decision = await authorize(lead.id, "n/a", "HUMAN");
      assert.equal(decision.allowed, false);
      assert.equal(!decision.allowed && decision.reason, "no_recipient");
    });
  });

  describe("human control", () => {
    it("refuses an AI send once a human has taken the conversation over", async () => {
      await setAiMode("AUTO");
      const { id, number } = await newLead({ ownerId: t.users.AGENT.id });
      assert.equal((await authorize(id, number, "AI")).allowed, true, "allowed before take-over");

      await takeOverLead(t.workspaceId, id, t.users.AGENT.id, { canReassign: true });

      const decision = await authorize(id, number, "AI");
      assert.equal(decision.allowed, false);
      assert.equal(!decision.allowed && decision.reason, "human_took_over");
      await setAiMode("DRAFT");
    });

    it("still allows the human who took over to reply", async () => {
      await setAiMode("AUTO");
      const { id, number } = await newLead({ ownerId: t.users.AGENT.id });
      await takeOverLead(t.workspaceId, id, t.users.AGENT.id, { canReassign: true });
      assert.equal((await authorize(id, number, "HUMAN")).allowed, true);
      await setAiMode("DRAFT");
    });

    /**
     * The race the advisory lock exists for: a take-over landing while an AI turn is mid-flight.
     * Both sides take the same conversation-control lock, so they serialize. Whichever commits
     * first, the outcome is never "the AI sent after the human took over" — which is what the
     * old code allowed, because it checked for the marker at the start of the turn and sent
     * seconds later.
     */
    it("serializes take-over against an in-flight AI authorization, under repeated attempts", async () => {
      await setAiMode("AUTO");
      for (let round = 0; round < 5; round++) {
        const { id, number } = await newLead({ ownerId: t.users.AGENT.id });

        const [aiDecision] = await Promise.all([
          prisma.$transaction(async (tx) => {
            await lockConversationControl(tx, t.workspaceId, id);
            return authorize(id, number, "AI");
          }),
          takeOverLead(t.workspaceId, id, t.users.AGENT.id, { canReassign: true }),
        ]);

        const tookOver = await prisma.activity.count({
          where: { workspaceId: t.workspaceId, leadId: id, metadata: { path: ["conversationTakeover"], equals: true } },
        });
        assert.equal(tookOver, 1, `round ${round}: take-over must always land`);

        // Once the take-over has committed, no further AI send may ever be authorized.
        const afterwards = await authorize(id, number, "AI");
        assert.equal(afterwards.allowed, false, `round ${round}: AI must be locked out after take-over`);
        assert.equal(!afterwards.allowed && afterwards.reason, "human_took_over", `round ${round}`);

        // The in-flight decision may legitimately have won the lock and been allowed; if it was
        // refused, it must be for the right reason and never a spurious failure.
        if (!aiDecision.allowed) {
          assert.equal(aiDecision.reason, "human_took_over", `round ${round}: in-flight refusal reason`);
        }
      }
      await setAiMode("DRAFT");
    });
  });
});
