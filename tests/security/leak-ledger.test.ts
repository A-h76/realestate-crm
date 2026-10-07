import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it, mock } from "node:test";
import { prisma } from "../../src/lib/db";

type Load = typeof import("../../src/lib/attention/leak-ledger").loadLeakLedger;
let loadLeakLedger: Load;
const MIN = 60_000;

describe("leak ledger", () => {
  const workspaceIds: string[] = [];
  let workspaceId: string;
  let ownerId: string;
  let userId: string;
  const now = new Date(Date.now() - 2 * 60 * MIN);

  const lead = (ownerOverride: string | null | undefined, minutesAgo: number, extra: Record<string, unknown> = {}, ws = workspaceId) =>
    prisma.lead.create({
      data: {
        workspaceId: ws,
        firstName: "L",
        lastName: randomUUID().slice(0, 4),
        stage: "NEW",
        ownerId: ownerOverride === undefined ? ownerId : ownerOverride,
        createdAt: new Date(now.getTime() - minutesAgo * MIN),
        ...extra,
      },
    });

  before(async () => {
    mock.module("server-only", { namedExports: {} });
    loadLeakLedger = (await import("../../src/lib/attention/leak-ledger")).loadLeakLedger;
    const ws = await prisma.workspace.create({ data: { name: "Ledger", slug: `ledger-${randomUUID()}` } });
    workspaceId = ws.id;
    workspaceIds.push(ws.id);
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.test`, name: "Agent", passwordHash: "x" } });
    userId = user.id;
    ownerId = user.id;
    await prisma.workspaceMember.create({ data: { workspaceId, userId, role: "AGENT" } });
  });

  after(async () => {
    for (const id of workspaceIds) await prisma.workspace.delete({ where: { id } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("measures real first-contact times, lists null as unknown, and excludes simulated traffic", async () => {
    const fast = await lead(undefined, 60, { firstContactAt: new Date(now.getTime() - 58 * MIN) }); // 2 min
    const slow = await lead(undefined, 50, { firstContactAt: new Date(now.getTime() - 20 * MIN) }); // 30 min
    const unknown = await lead(undefined, 40); // never contacted
    const unowned = await lead(null, 30);
    const waiting = await lead(undefined, 25);
    await prisma.whatsAppMessage.create({
      data: { workspaceId, conversationId: `lead:${waiting.id}`, direction: "INBOUND", body: "hi", status: "DELIVERED", leadId: waiting.id, provider: "whatsapp-business", sentAt: new Date(now.getTime() - 20 * MIN) },
    });
    // Simulated: demo-provider message, and a creation audit tagged simulated. Neither may be counted anywhere.
    const demoMsg = await lead(null, 90, { firstContactAt: new Date(now.getTime() - 89 * MIN) });
    await prisma.whatsAppMessage.create({
      data: { workspaceId, conversationId: `lead:${demoMsg.id}`, direction: "INBOUND", body: "demo", status: "DELIVERED", leadId: demoMsg.id, provider: "demo", sentAt: new Date(now.getTime() - 89 * MIN) },
    });
    const tagged = await lead(null, 80);
    await prisma.auditLog.create({ data: { workspaceId, action: "LEAD_CREATED", entity: "Lead", entityId: tagged.id, metadata: { simulated: true } } });
    await prisma.auditLog.create({ data: { workspaceId, action: "CUSTODY_SLA_BREACH", entity: "Lead", entityId: tagged.id, occurredAt: now } });
    await prisma.auditLog.create({ data: { workspaceId, action: "CUSTODY_SLA_BREACH", entity: "Lead", entityId: waiting.id, occurredAt: now } });

    const ledger = await loadLeakLedger(workspaceId, now);
    assert.equal(ledger.demoWorkspace, false);
    assert.equal(ledger.leads, 5, "simulated leads are not counted");
    assert.deepEqual(ledger.firstResponse, { measured: 2, withinSla: 1, medianMin: 2, p90Min: 30, clock: { receivedAt: 0, createdAt: 2 } });
    assert.deepEqual(ledger.unknown.sample.map((l) => l.id).sort(), [unknown.id, unowned.id, waiting.id].sort(), "null firstContactAt is unknown, not a computed time");
    assert.ok(!ledger.unknown.sample.some((l) => [fast.id, slow.id, demoMsg.id, tagged.id].includes(l.id)));
    assert.deepEqual(ledger.unowned.sample.map((l) => l.id), [unowned.id]);
    assert.deepEqual(ledger.unanswered.sample.map((l) => l.id), [waiting.id]);
    assert.equal(ledger.sweeper.since, null, "sweeper never ran: breaches are unmeasured");
    assert.equal(ledger.sweeper.slaBreaches, 1, "the simulated lead's breach is excluded");
  });

  it("an imported lead is timed from receivedAt, not from the import; a contact before receivedAt is unknown", async () => {
    const ws = await prisma.workspace.create({ data: { name: "Clock", slug: `ledger-clock-${randomUUID()}` } });
    workspaceIds.push(ws.id);
    // Added to the CRM 60 min ago but really received 3 days earlier; first contact 55 min ago.
    const received = new Date(now.getTime() - 3 * 24 * 60 * MIN);
    const imported = await lead(null, 60, { receivedAt: received, firstContactAt: new Date(now.getTime() - 55 * MIN) }, ws.id);
    // Same shape without receivedAt: createdAt is the clock, so this one is a 5 minute response.
    await lead(null, 60, { firstContactAt: new Date(now.getTime() - 55 * MIN) }, ws.id);
    // Contact recorded before the claimed receipt time is incoherent: unknown, never a negative or invented time.
    const incoherent = await lead(null, 60, { receivedAt: new Date(now.getTime() - 10 * MIN), firstContactAt: new Date(now.getTime() - 55 * MIN) }, ws.id);

    const r = (await loadLeakLedger(ws.id, now)).firstResponse;
    assert.equal(r.measured, 2);
    assert.equal(r.withinSla, 1, "only the createdAt-clocked lead beat 5 minutes; the import took ~3 days");
    assert.deepEqual(r.clock, { receivedAt: 1, createdAt: 1 });
    assert.ok(imported.id && incoherent.id);
  });

  it("a demo workspace measures nothing", async () => {
    const ws = await prisma.workspace.create({ data: { name: "Demo", slug: `ledger-demo-${randomUUID()}`, isDemo: true } });
    workspaceIds.push(ws.id);
    await lead(null, 10, {}, ws.id);
    const ledger = await loadLeakLedger(ws.id, now);
    assert.equal(ledger.demoWorkspace, true);
    assert.equal(ledger.leads, 0);
    assert.equal(ledger.unowned.count, 0);
  });

  it("source coverage: declared vs live, last event from real traffic only", async () => {
    const ws = await prisma.workspace.create({ data: { name: "Coverage", slug: `ledger-cov-${randomUUID()}` } });
    workspaceIds.push(ws.id);
    const before = await loadLeakLedger(ws.id, now);
    assert.equal(before.coverage.declaredCount, 0, "nothing declared: coverage is unknown, not 100%");

    await prisma.sourceDeclaration.createMany({ data: [{ workspaceId: ws.id, source: "WHATSAPP_INBOUND" }, { workspaceId: ws.id, source: "ZILLOW" }] });
    await lead(null, 30, { source: "ZILLOW" }, ws.id);
    await lead(null, 20, { source: "FACEBOOK_ADS" }, ws.id); // produces leads but was never declared

    let cov = (await loadLeakLedger(ws.id, now)).coverage;
    assert.equal(cov.declaredCount, 2);
    assert.equal(cov.liveCount, 0, "no WhatsApp integration yet");
    const zillow = cov.rows.find((r) => r.source === "ZILLOW")!;
    assert.deepEqual([zillow.declared, zillow.feed, zillow.lastEventAt?.getTime()], [true, "manual_only", now.getTime() - 30 * MIN]);
    assert.equal(cov.rows.find((r) => r.source === "FACEBOOK_ADS")?.declared, false);

    await prisma.whatsAppIntegration.create({ data: { workspaceId: ws.id, phoneNumberId: `pn-${randomUUID()}` } });
    cov = (await loadLeakLedger(ws.id, now)).coverage;
    assert.equal(cov.liveCount, 1);
    assert.equal(cov.rows.find((r) => r.source === "WHATSAPP_INBOUND")?.feed, "live");
  });
});
