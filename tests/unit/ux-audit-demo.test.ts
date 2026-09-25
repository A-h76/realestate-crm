import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/lib/db";
import { filterAndScoreProperties } from "../../src/lib/matching/properties";
import {
  seedUxAuditWorkspace,
  UX_AUDIT_SLUG,
  UX_AUDIT_USERS,
  UX_AUDIT_WORKSPACE_ID as WS,
  type UxAuditSeedResult,
} from "../../prisma/seed-ux-audit-data";

/**
 * Runs the real UX-audit seed twice against the test database, next to an
 * unrelated "bystander" workspace, and checks isolation, idempotency, roles,
 * volumes, and that the WhatsApp engine produced each designed scenario.
 * Rebuilds the local UX demo workspace as a side effect (that is what reset does).
 */
describe("UX audit demo workspace seed", { timeout: 180_000 }, () => {
  let bystanderId: string;
  let bystanderLeadId: string;
  let first: UxAuditSeedResult;
  let second: UxAuditSeedResult;
  const env = { DEMO_MODE: process.env.DEMO_MODE, OPENAI_API_KEY: process.env.OPENAI_API_KEY };

  before(async () => {
    process.env.DEMO_MODE = "true";
    process.env.DEMO_SEED_PASSWORD ??= `test-${randomUUID()}`;
    delete process.env.OPENAI_API_KEY;

    const bystander = await prisma.workspace.create({
      data: { name: "Bystander", slug: `ux-bystander-${randomUUID()}` },
    });
    bystanderId = bystander.id;
    bystanderLeadId = (await prisma.lead.create({ data: { workspaceId: bystanderId, firstName: "Untouched" } })).id;

    first = await seedUxAuditWorkspace();
    second = await seedUxAuditWorkspace();
  });

  after(async () => {
    await prisma.workspace.delete({ where: { id: bystanderId } });
    process.env.DEMO_MODE = env.DEMO_MODE;
    if (env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = env.OPENAI_API_KEY;
  });

  it("is refused outside Demo Mode", async () => {
    process.env.DEMO_MODE = "false";
    await assert.rejects(seedUxAuditWorkspace(), /DEMO_MODE/);
    process.env.DEMO_MODE = "true";
  });

  it("creates one clearly-marked demo workspace", async () => {
    const workspaces = await prisma.workspace.findMany({ where: { slug: UX_AUDIT_SLUG } });
    assert.equal(workspaces.length, 1);
    assert.equal(workspaces[0].isDemo, true);
    assert.match(workspaces[0].name, /UX Audit Demo/);
  });

  it("assigns OWNER, MANAGER and AGENT to the three demo users", async () => {
    const members = await prisma.workspaceMember.findMany({ where: { workspaceId: WS }, include: { user: true } });
    assert.deepEqual(
      members.map((m) => `${m.user.email}:${m.role}`).sort(),
      UX_AUDIT_USERS.map((u) => `${u.email}:${u.role}`).sort(),
    );
  });

  it("seeds the requested volumes", () => {
    const c = second.counts;
    const within = (n: number, lo: number, hi: number, label: string) => assert.ok(n >= lo && n <= hi, `${label}=${n}`);
    within(c.leads, 15, 25, "leads");
    within(c.contacts, 10, 20, "contacts");
    within(c.properties, 15, 30, "properties");
    within(c.opportunities, 8, 12, "opportunities");
    within(c.tasks, 10, 20, "tasks");
    within(c.calendarEvents, 5, 8, "calendarEvents");
    within(c.proposals, 4, 6, "proposals");
    within(c.whatsappConversations, 8, 12, "whatsappConversations");
  });

  it("is idempotent: a rerun yields the same counts, not duplicates", () => {
    assert.deepEqual(second.counts, first.counts);
  });

  it("never touches other workspaces", async () => {
    const lead = await prisma.lead.findUnique({ where: { id: bystanderLeadId } });
    assert.equal(lead?.workspaceId, bystanderId);
    assert.equal(await prisma.lead.count({ where: { workspaceId: bystanderId } }), 1);
  });

  it("keeps every relation inside the demo workspace", async () => {
    const opps = await prisma.opportunity.findMany({
      where: { workspaceId: WS },
      include: { lead: true, linkedProperty: true, primaryContact: true, stage: true },
    });
    for (const o of opps) {
      for (const rel of [o.lead, o.linkedProperty, o.primaryContact, o.stage]) {
        if (rel) assert.equal(rel.workspaceId, WS, `opportunity ${o.id}`);
      }
    }
    const foreignMessages = await prisma.whatsAppMessage.count({ where: { workspaceId: WS, lead: { workspaceId: { not: WS } } } });
    assert.equal(foreignMessages, 0);
    const foreignTasks = await prisma.task.count({ where: { workspaceId: WS, lead: { workspaceId: { not: WS } } } });
    assert.equal(foreignTasks, 0);
  });

  const leadFor = (key: string) =>
    prisma.lead.findUniqueOrThrow({ where: { id: second.conversationLeadIds[key] } });
  const handoffTasks = (leadId: string) =>
    prisma.task.findMany({ where: { workspaceId: WS, leadId, description: { contains: "[handoff:" } } });
  const properties = () => prisma.property.findMany({ where: { workspaceId: WS } });

  it("Flow 1: creates a lead from WhatsApp and extracts the requirement", async () => {
    const lead = await leadFor("flow1_new_lead");
    assert.equal(lead.source, "WHATSAPP_INBOUND");
    assert.equal(lead.preferredArea, "DHA Phase 2");
    assert.equal(lead.propertyPurpose, "RENT");
    assert.equal(lead.propertyTypePref, "HOUSE");
    assert.equal(Number(lead.sizePrefMin), 5);
    assert.equal(Number(lead.budgetMax), 50_000);
    assert.equal(lead.ownerId, null, "brand-new lead stays unassigned for the manager to assign");
  });

  it("Flow 2: leaves an incomplete requirement with the next question asked", async () => {
    const lead = await leadFor("flow2_incomplete");
    assert.equal(lead.propertyTypePref, "HOUSE");
    assert.equal(lead.preferredArea, "DHA");
    assert.equal(lead.propertyPurpose, null);
    assert.equal(lead.budgetMax, null);
    const last = await prisma.whatsAppMessage.findFirst({ where: { leadId: lead.id }, orderBy: { sentAt: "desc" } });
    assert.equal((last?.metadata as { decision?: string }).decision, "ASK_QUESTION");
  });

  it("Flow 3: grounded DHA Phase 2 rent matches exist and were shown", async () => {
    const lead = await leadFor("flow3_grounded_match");
    const matches = filterAndScoreProperties(lead, await properties());
    const grounded = matches.filter((m) => m.property.area === "DHA Phase 2" && m.property.purpose === "RENT");
    assert.ok(grounded.length >= 2);
    const decisions = await prisma.whatsAppMessage.findMany({ where: { leadId: lead.id, direction: "OUTBOUND" } });
    assert.ok(decisions.some((m) => (m.metadata as { decision?: string }).decision === "SHOW_MATCH_DETAILS"));
    assert.equal(lead.stage, "QUALIFIED");
  });

  it("Flow 4: no grounded match hands off without inventing alternatives", async () => {
    const lead = await leadFor("flow4_no_match");
    assert.equal(filterAndScoreProperties(lead, await properties()).length, 0);
    const tasks = await handoffTasks(lead.id);
    assert.equal(tasks.length, 1);
    assert.ok(tasks[0].description?.includes("[handoff:NO_GROUNDED_INVENTORY_MATCH]"));
    const replies = await prisma.whatsAppMessage.findMany({ where: { leadId: lead.id, direction: "OUTBOUND" } });
    assert.ok(replies.every((m) => !/Rs \d/.test(m.body)), "no property offered to the customer");
    // Handoff TRIGGERED, not taken over: task still TODO, audit logged, no takeover marker, so the AI may still reply.
    assert.equal(tasks[0].status, "TODO");
    assert.equal(await prisma.auditLog.count({ where: { workspaceId: WS, entityId: lead.id, action: "HANDOFF_TRIGGERED" } }), 1);
    assert.equal(
      await prisma.activity.count({ where: { leadId: lead.id, metadata: { path: ["conversationTakeover"], equals: true } } }),
      0,
    );
  });

  it("Flow 5: a pending handoff is open and not yet taken over", async () => {
    const lead = await leadFor("flow5_handoff_pending");
    const tasks = await handoffTasks(lead.id);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].status, "TODO");
    const takeover = await prisma.activity.count({
      where: { leadId: lead.id, metadata: { path: ["conversationTakeover"], equals: true } },
    });
    assert.equal(takeover, 0);
  });

  it("Agent takeover: AI stops replying once a human has taken over", async () => {
    const lead = await leadFor("takeover_done");
    const takeover = await prisma.activity.findFirstOrThrow({
      where: { leadId: lead.id, metadata: { path: ["conversationTakeover"], equals: true } },
    });
    assert.ok(takeover);
    const messages = await prisma.whatsAppMessage.findMany({ where: { leadId: lead.id }, orderBy: { sentAt: "asc" } });
    const humanIdx = messages.findIndex((m) => m.senderId);
    assert.ok(humanIdx > 0, "agent sent a manual message");
    assert.ok(messages.slice(humanIdx).every((m) => m.direction === "INBOUND" || m.senderId), "no auto-reply after takeover");
    assert.equal((await handoffTasks(lead.id))[0].status, "IN_PROGRESS");
  });

  it("Flow 7-9: site visit, proposal states and won conversion are in place", async () => {
    const adeel = await leadFor("flow7_site_visit");
    const visit = await prisma.calendarEvent.findFirstOrThrow({ where: { leadId: adeel.id, type: "SITE_VISIT" } });
    assert.equal(visit.status, "SCHEDULED");
    assert.ok(visit.startAt > new Date());

    const visitStatuses = new Set((await prisma.calendarEvent.findMany({ where: { workspaceId: WS, type: "SITE_VISIT" } })).map((v) => v.status));
    for (const s of ["SCHEDULED", "COMPLETED", "NO_SHOW", "CANCELLED"] as const) assert.ok(visitStatuses.has(s), s);

    const proposalStatuses = new Set((await prisma.proposal.findMany({ where: { workspaceId: WS } })).map((p) => p.status));
    for (const s of ["DRAFT", "SENT", "VIEWED", "ACCEPTED"] as const) assert.ok(proposalStatuses.has(s), s);

    const won = await prisma.opportunity.findMany({ where: { workspaceId: WS, stage: { isWon: true } }, include: { lead: true } });
    assert.ok(won.length >= 1);
    assert.ok(won.every((o) => o.lead?.stage === "CONVERTED"));

    const stages = new Set((await prisma.opportunity.findMany({ where: { workspaceId: WS }, include: { stage: true } })).map((o) => o.stage.slug));
    for (const s of ["new", "qualified", "discovery", "proposal", "negotiation", "won", "lost"]) assert.ok(stages.has(s), s);
  });

  it("covers overdue, due-today, upcoming and completed tasks across users", async () => {
    const tasks = await prisma.task.findMany({ where: { workspaceId: WS } });
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay.getTime() + 86_400_000);
    const open = tasks.filter((t) => t.status === "TODO" || t.status === "IN_PROGRESS");
    assert.ok(open.some((t) => t.dueAt && t.dueAt < startOfDay), "overdue");
    assert.ok(open.some((t) => t.dueAt && t.dueAt >= startOfDay && t.dueAt < endOfDay), "due today");
    assert.ok(open.some((t) => t.dueAt && t.dueAt >= endOfDay), "upcoming");
    assert.ok(tasks.some((t) => t.status === "DONE"), "completed");
    assert.ok(new Set(tasks.map((t) => t.ownerId).filter(Boolean)).size >= 3, "assigned to different users");
  });
});
