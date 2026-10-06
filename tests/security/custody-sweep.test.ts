import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it, mock } from "node:test";
import { prisma } from "../../src/lib/db";

type Sweep = typeof import("../../src/lib/custody/sweep").sweepCustody;
let sweepCustody: Sweep;

const MIN = 60_000;

describe("custody sweep", () => {
  const workspaceIds: string[] = [];
  const userIds: string[] = [];
  let workspaceId: string;
  let agentId: string;
  let managerId: string;
  let T0: number;

  async function member(wsId: string, role: "AGENT" | "MANAGER") {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.test`, name: role, passwordHash: "x" } });
    userIds.push(user.id);
    await prisma.workspaceMember.create({ data: { workspaceId: wsId, userId: user.id, role } });
    return user.id;
  }

  async function inboundLead(wsId: string, ownerId: string | null, body = "hello") {
    const lead = await prisma.lead.create({
      data: { workspaceId: wsId, firstName: "Waiting", lastName: randomUUID().slice(0, 4), stage: "NEW", ownerId, createdAt: new Date(T0) },
    });
    await prisma.whatsAppMessage.create({
      data: { workspaceId: wsId, conversationId: `lead:${lead.id}`, direction: "INBOUND", body, status: "DELIVERED", leadId: lead.id, provider: "whatsapp-business", sentAt: new Date(T0) },
    });
    return lead;
  }

  const notesFor = (leadId: string) => prisma.notification.findMany({ where: { workspaceId, entityId: leadId, type: "RESPONSE_SLA_BREACH" } });
  const auditFor = (leadId: string, action: "CUSTODY_SLA_BREACH" | "CUSTODY_ESCALATED") =>
    prisma.auditLog.findMany({ where: { workspaceId, entityId: leadId, action } });

  before(async () => {
    // The attention loader imports "server-only", which throws outside a React server build.
    mock.module("server-only", { namedExports: {} });
    sweepCustody = (await import("../../src/lib/custody/sweep")).sweepCustody;
    T0 = Date.now() - 60 * MIN; // keep every sweep "now" in the past, away from real-clock activity
    const ws = await prisma.workspace.create({ data: { name: "Custody sweep", slug: `sweep-${randomUUID()}` } });
    workspaceId = ws.id;
    workspaceIds.push(ws.id);
    agentId = await member(workspaceId, "AGENT");
    managerId = await member(workspaceId, "MANAGER");
    // The first sweep of a workspace is silent by design; burn it so the tests below run live.
    const first = await sweepCustody(workspaceId, { now: new Date(T0) });
    assert.equal(first?.silent, true);
  });

  after(async () => {
    for (const id of workspaceIds) await prisma.workspace.delete({ where: { id } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  it("a waiting customer: nothing before the SLA, owner notified once at 5 min, managers once at 15 min", async () => {
    const lead = await inboundLead(workspaceId, agentId);

    await sweepCustody(workspaceId, { now: new Date(T0 + 2 * MIN) });
    assert.equal((await notesFor(lead.id)).length, 0, "inside the SLA nobody is bothered");

    await sweepCustody(workspaceId, { now: new Date(T0 + 6 * MIN) });
    await sweepCustody(workspaceId, { now: new Date(T0 + 7 * MIN) });
    const owner = await notesFor(lead.id);
    assert.equal(owner.length, 1, "a second sweep in the same wait does not re-notify");
    assert.equal(owner[0].userId, agentId);
    const breach = await auditFor(lead.id, "CUSTODY_SLA_BREACH");
    assert.equal(breach.length, 1);
    assert.equal(breach[0].actorType, "SYSTEM");
    assert.equal(breach[0].occurredAt.getTime(), T0 + 6 * MIN);
    assert.equal((await auditFor(lead.id, "CUSTODY_ESCALATED")).length, 0);

    await sweepCustody(workspaceId, { now: new Date(T0 + 16 * MIN) });
    await sweepCustody(workspaceId, { now: new Date(T0 + 17 * MIN) });
    const all = await notesFor(lead.id);
    assert.deepEqual(all.map((n) => n.userId).sort(), [agentId, managerId].sort());
    assert.equal((await auditFor(lead.id, "CUSTODY_ESCALATED")).length, 1);
  });

  it("an answered customer is not a breach", async () => {
    const lead = await inboundLead(workspaceId, agentId);
    await prisma.whatsAppMessage.create({
      data: { workspaceId, conversationId: `lead:${lead.id}`, direction: "OUTBOUND", body: "hi!", status: "SENT", leadId: lead.id, provider: "whatsapp-business", sentAt: new Date(T0 + MIN) },
    });
    await sweepCustody(workspaceId, { now: new Date(T0 + 20 * MIN) });
    assert.equal((await notesFor(lead.id)).length, 0);
  });

  it("an unowned lead is assigned to an agent", async () => {
    const lead = await inboundLead(workspaceId, null);
    const result = await sweepCustody(workspaceId, { now: new Date(T0 + 2 * MIN) });
    assert.ok(result && result.assigned >= 1);
    const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    assert.equal(after.ownerId, agentId);
    assert.ok(after.assignedAt);
    const told = await prisma.notification.findMany({ where: { workspaceId, entityId: lead.id, type: "LEAD_ASSIGNED" } });
    assert.deepEqual(told.map((n) => n.userId), [agentId], "the new owner is told at assignment");
    await sweepCustody(workspaceId, { now: new Date(T0 + 3 * MIN) });
    assert.equal((await prisma.notification.count({ where: { workspaceId, entityId: lead.id, type: "LEAD_ASSIGNED" } })), 1, "deduped");
  });

  it("a workspace with no agents escalates an unowned waiting lead straight to its manager", async () => {
    const ws = await prisma.workspace.create({ data: { name: "No agents", slug: `sweep-noagent-${randomUUID()}` } });
    workspaceIds.push(ws.id);
    const manager = await member(ws.id, "MANAGER");
    const lead = await inboundLead(ws.id, null);
    await sweepCustody(ws.id, { now: new Date(T0) }); // silent first pass
    const result = await sweepCustody(ws.id, { now: new Date(T0 + 6 * MIN) });
    assert.equal(result?.assigned, 0);
    const notes = await prisma.notification.findMany({ where: { workspaceId: ws.id, entityId: lead.id } });
    assert.deepEqual(notes.map((n) => n.userId), [manager]);
    const esc = await prisma.auditLog.findFirstOrThrow({ where: { workspaceId: ws.id, entityId: lead.id, action: "CUSTODY_ESCALATED" } });
    assert.equal((esc.metadata as { ownerless: boolean }).ownerless, true);
  });

  it("backlog guard: a breach older than the age cutoff is never notified, a fresh one is", async () => {
    const day = 24 * 60 * MIN;
    const old = await inboundLead(workspaceId, agentId); // waiting since T0
    const now = new Date(T0 + day + 30 * MIN);
    const fresh = await inboundLead(workspaceId, agentId);
    await prisma.whatsAppMessage.updateMany({ where: { leadId: fresh.id }, data: { sentAt: new Date(now.getTime() - 6 * MIN) } });
    await sweepCustody(workspaceId, { now });
    assert.equal((await notesFor(old.id)).length, 0, "weeks-old waits are history");
    assert.equal((await notesFor(fresh.id)).length, 1, "a fresh breach still pages the owner");
  });

  it("first run in a workspace is silent, the second is live", async () => {
    const ws = await prisma.workspace.create({ data: { name: "Silent first", slug: `sweep-silent-${randomUUID()}` } });
    workspaceIds.push(ws.id);
    const agent = await member(ws.id, "AGENT");
    const lead = await inboundLead(ws.id, agent);
    const now = new Date(T0 + 10 * MIN);
    const first = await sweepCustody(ws.id, { now });
    assert.equal(first?.silent, true);
    assert.equal(first?.breaches, 0);
    assert.equal((await prisma.notification.count({ where: { workspaceId: ws.id, entityId: lead.id } })), 0);
    const second = await sweepCustody(ws.id, { now: new Date(now.getTime() + MIN) });
    assert.equal(second?.silent, false);
    assert.equal(second?.breaches, 1);
    assert.equal((await prisma.notification.count({ where: { workspaceId: ws.id, entityId: lead.id } })), 1);
  });

  it("does nothing while another run holds the workspace lock", async () => {
    let result: Awaited<ReturnType<Sweep>> | undefined;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`custody-sweep:${workspaceId}`}))`;
      result = await sweepCustody(workspaceId, { now: new Date(T0 + 30 * MIN) });
    });
    assert.equal(result, null);
  });
});
