import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/lib/db";
import { actAs, call, createTenant, destroyTenant, installSessionMock, ROLES, type Tenant } from "../helpers/http";

/**
 * INTG-007: human handoff take-over. Real route, real database. Ownership rule: unowned or your own lead needs
 * crm:write; a lead someone else owns needs leads:assign (OWNER/ADMIN/MANAGER). Concurrent takers: one wins, the
 * rest are refused, nothing is silently overwritten.
 */
type Handler = Parameters<typeof call>[0];
let TAKE_OVER: Handler;

describe("POST /api/leads/:id/take-over", () => {
  let t: Tenant;
  let other: Tenant;
  let extra: { id: string };

  before(async () => {
    installSessionMock();
    ({ POST: TAKE_OVER } = await import("../../src/app/api/leads/[id]/take-over/route"));
    t = await createTenant("takeover");
    other = await createTenant("takeover-other");
    // a second agent in the same workspace, to race against t.users.AGENT
    const { randomUUID } = await import("node:crypto");
    extra = await prisma.user.create({ data: { email: `agent2-${randomUUID()}@example.test`, name: "Second Agent", passwordHash: "x" } });
    await prisma.workspaceMember.create({ data: { workspaceId: t.workspaceId, userId: extra.id, role: "AGENT" } });
  });

  after(async () => {
    await destroyTenant(t);
    await destroyTenant(other);
    await prisma.user.deleteMany({ where: { id: extra.id } });
  });

  const lead = (workspaceId: string, ownerId: string | null) =>
    prisma.lead.create({ data: { workspaceId, firstName: "Handoff", whatsappNumber: "+14155550123", ownerId } }).then((l) => l.id);
  const take = (id: string) => call(TAKE_OVER, "POST", { params: { id } });
  const asExtra = () => actAs({ id: extra.id, email: "x", name: "Second Agent", workspaceId: t.workspaceId, role: "AGENT" });
  const notes = (leadId: string) => prisma.activity.count({ where: { leadId, title: "Agent took over conversation" } });

  for (const role of ROLES) {
    it(`${role}: ${role === "VIEWER" ? "cannot" : "can"} take over an unowned lead`, async () => {
      const id = await lead(t.workspaceId, null);
      actAs(t.users[role]);
      const res = await take(id);
      assert.equal(res.status, role === "VIEWER" ? 403 : 200);
      assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id } })).ownerId, role === "VIEWER" ? null : t.users[role].id);
    });
  }

  it("claims the open handoff task, writes the takeover marker, and audits the ownership change", async () => {
    const id = await lead(t.workspaceId, t.users.AGENT.id);
    await prisma.task.create({ data: { workspaceId: t.workspaceId, leadId: id, title: "Human handoff", description: "[handoff:HUMAN_REQUESTED] asked", status: "TODO" } });
    actAs(t.users.AGENT);
    const res = await take(id);
    assert.equal(res.status, 200);
    assert.equal(res.body.handoffTasksClaimed, 1);
    assert.equal((await prisma.task.findFirstOrThrow({ where: { leadId: id } })).status, "IN_PROGRESS");
    const marker = await prisma.activity.findFirstOrThrow({ where: { leadId: id, title: "Agent took over conversation" } });
    assert.deepEqual(marker.metadata, { conversationTakeover: true });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { workspaceId: t.workspaceId, entityId: id, action: "LEAD_UPDATED" } });
    assert.equal(audit.actorId, t.users.AGENT.id);
    assert.equal((audit.metadata as { reason: string }).reason, "handoff_take_over");
  });

  it("an agent cannot take a lead another agent owns: 403, owner and history untouched", async () => {
    const id = await lead(t.workspaceId, t.users.AGENT.id);
    asExtra();
    const res = await take(id);
    assert.equal(res.status, 403);
    assert.match(res.body.error, /being handled by/);
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id } })).ownerId, t.users.AGENT.id);
    assert.equal(await notes(id), 0);
  });

  it("a manager can take over a lead another agent owns (it is a reassignment)", async () => {
    const id = await lead(t.workspaceId, t.users.AGENT.id);
    actAs(t.users.MANAGER);
    assert.equal((await take(id)).status, 200);
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id } })).ownerId, t.users.MANAGER.id);
  });

  it("repeating your own take-over is a no-op: no second note, no second audit row", async () => {
    const id = await lead(t.workspaceId, null);
    actAs(t.users.AGENT);
    assert.equal((await take(id)).status, 200);
    const again = await take(id);
    assert.equal(again.status, 200);
    assert.equal(again.body.alreadyHandling, true);
    assert.equal(await notes(id), 1);
    assert.equal(await prisma.auditLog.count({ where: { entityId: id, action: "LEAD_UPDATED" } }), 1);
  });

  it("a taker queued behind a concurrent claim sees the new owner and is refused instead of overwriting it", async () => {
    const id = await lead(t.workspaceId, null);
    const { takeOverLead } = await import("../../src/lib/leads/take-over");
    // Another connection holds the lead row (as a concurrent take-over would), then hands the lead to agent 2.
    let locked!: () => void;
    let release!: () => void;
    const lockedP = new Promise<void>((r) => (locked = r));
    const releaseP = new Promise<void>((r) => (release = r));
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Lead" WHERE id = ${id} FOR NO KEY UPDATE`;
        locked();
        await releaseP;
        await tx.lead.update({ where: { id }, data: { ownerId: extra.id } });
      },
      { timeout: 30_000 },
    );
    await lockedP;
    const queued = takeOverLead(t.workspaceId, id, t.users.AGENT.id, { canReassign: false }).then(
      () => "claimed",
      (e: { status?: number }) => `refused:${e.status}`,
    );
    await new Promise((r) => setTimeout(r, 300)); // without the row lock the taker would already have finished here
    assert.equal(await Promise.race([queued, Promise.resolve("still waiting")]), "still waiting");
    release();
    await holder;
    assert.equal(await queued, "refused:403");
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id } })).ownerId, extra.id, "the first claim stands");
    assert.equal(await notes(id), 0, "the refused taker wrote nothing");
  });

  it("a lead in another workspace is a 404 and is not modified", async () => {
    const foreign = await lead(other.workspaceId, null);
    actAs(t.users.OWNER);
    assert.equal((await take(foreign)).status, 404);
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: foreign } })).ownerId, null);
    assert.equal((await take("does-not-exist")).status, 404);
  });

  it("after take-over the automatic conversational reply is suppressed (the marker the orchestrator reads)", async () => {
    const id = await lead(t.workspaceId, null);
    actAs(t.users.AGENT);
    await take(id);
    const { runConversationTurn } = await import("../../src/lib/whatsapp/conversation-orchestrator");
    const msg = await prisma.whatsAppMessage.create({
      data: { workspaceId: t.workspaceId, conversationId: `lead:${id}`, direction: "INBOUND", body: "rent in Lincoln Park", status: "DELIVERED", leadId: id, provider: "demo" },
    });
    assert.equal(await runConversationTurn({ workspaceId: t.workspaceId, leadId: id, conversationId: `lead:${id}`, messageId: msg.id, message: "rent in Lincoln Park" }), null);
    assert.equal(await prisma.whatsAppMessage.count({ where: { leadId: id, direction: "OUTBOUND" } }), 0);
  });
});
