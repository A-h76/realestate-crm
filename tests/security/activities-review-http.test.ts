import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/lib/db";
import { classifyInvitation, invitationStatesFor } from "../../src/lib/workspace/invitation-status";
import { hashSetupToken } from "../../src/lib/workspace/account-setup";
import { actAs, call, createTenant, destroyTenant, freshIp, installSessionMock, ROLES, type Tenant } from "../helpers/http";

/**
 * CORE-003: the routes that now have a UI entry point (POST /api/activities from "Log an activity",
 * POST /api/intelligence/review from the Approve/Reject buttons), and the invitation-state data behind the
 * Team screen. Authorization, workspace scoping, validation, audit.
 */
type Handler = Parameters<typeof call>[0];
let ACTIVITIES: { GET: Handler; POST: Handler };
let REVIEW: Handler;
let MEMBERS: Handler;
let ACCEPT: Handler;

const SALES = ["OWNER", "ADMIN", "MANAGER", "AGENT"] as const;
const MANAGERS = ["OWNER", "ADMIN", "MANAGER"] as const;

describe("POST /api/activities (Log an activity)", () => {
  let a: Tenant;
  let b: Tenant;
  let leadA: string;
  let leadB: string;

  before(async () => {
    installSessionMock();
    ACTIVITIES = await import("../../src/app/api/activities/route");
    a = await createTenant("act-a");
    b = await createTenant("act-b");
    leadA = (await prisma.lead.create({ data: { workspaceId: a.workspaceId, firstName: "A" } })).id;
    leadB = (await prisma.lead.create({ data: { workspaceId: b.workspaceId, firstName: "B" } })).id;
  });

  after(async () => {
    await destroyTenant(a);
    await destroyTenant(b);
  });

  const log = (body: Record<string, unknown>) => call(ACTIVITIES.POST, "POST", { body });

  for (const role of ROLES) {
    it(`${role}: ${SALES.includes(role as (typeof SALES)[number]) ? "can" : "cannot"} log a call`, async () => {
      actAs(a.users[role]);
      const res = await log({ type: "CALL", leadId: leadA, status: "COMPLETED", title: `Call by ${role}`, notes: "Spoke about budget" });
      assert.equal(res.status, SALES.includes(role as (typeof SALES)[number]) ? 201 : 403);
    });
  }

  it("records the actor as owner, links the lead, bumps last activity, and writes an audit row", async () => {
    actAs(a.users.AGENT);
    const before_ = (await prisma.lead.findUniqueOrThrow({ where: { id: leadA } })).lastActivityAt;
    const res = await log({ type: "MEETING", leadId: leadA, status: "COMPLETED", title: "Office visit", notes: "Brought documents" });
    assert.equal(res.status, 201);
    assert.equal(res.body.ownerId, a.users.AGENT.id);
    assert.equal(res.body.workspaceId, a.workspaceId);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadA } });
    assert.ok(lead.lastActivityAt && (!before_ || lead.lastActivityAt >= before_));
    assert.equal(await prisma.auditLog.count({ where: { workspaceId: a.workspaceId, action: "ACTIVITY_CREATED", entityId: res.body.id } }), 1);
  });

  it("only hand-loggable types are accepted: system-owned types cannot be forged through the API", async () => {
    actAs(a.users.OWNER);
    for (const type of ["STAGE_CHANGE", "SYSTEM", "TASK", "SITE_VISIT", "WHATSAPP_MESSAGE", "NOPE"]) {
      const res = await log({ type, leadId: leadA, title: `forged ${type}` });
      assert.equal(res.status, 400, type);
    }
    assert.equal(await prisma.activity.count({ where: { workspaceId: a.workspaceId, title: { startsWith: "forged" } } }), 0);
    for (const type of ["CALL", "EMAIL", "MEETING", "NOTE", "FOLLOW_UP"]) {
      assert.equal((await log({ type, leadId: leadA, title: `ok ${type}` })).status, 201, type);
    }
  });

  it("cannot attach an activity to another workspace's lead", async () => {
    actAs(a.users.OWNER);
    const res = await log({ type: "NOTE", leadId: leadB, notes: "sneaky" });
    assert.ok([400, 404].includes(res.status), String(res.status));
    assert.equal(await prisma.activity.count({ where: { leadId: leadB } }), 0);
  });

  it("the timeline list is scoped to the caller's workspace", async () => {
    actAs(b.users.OWNER);
    await call(ACTIVITIES.POST, "POST", { body: { type: "NOTE", leadId: leadB, title: "B-only note" } });
    actAs(a.users.OWNER);
    const res = await call(ACTIVITIES.GET, "GET");
    assert.equal(res.status, 200);
    assert.ok(!JSON.stringify(res.body).includes("B-only note"));
  });
});

describe("POST /api/intelligence/review (Approve / Reject)", () => {
  let a: Tenant;
  let b: Tenant;
  let runA: string;
  let runB: string;
  let leadA: string;

  before(async () => {
    installSessionMock();
    ({ POST: REVIEW } = await import("../../src/app/api/intelligence/review/route"));
    a = await createTenant("rev-a");
    b = await createTenant("rev-b");
    leadA = (await prisma.lead.create({ data: { workspaceId: a.workspaceId, firstName: "Reviewed", stage: "NEW" } })).id;
    const mk = (t: Tenant, leadId: string | null) =>
      prisma.intelligenceRun
        .create({ data: { workspaceId: t.workspaceId, kind: "LEAD_ANALYSIS", model: "deterministic", promptVersion: "v1", entityType: "Lead", entityId: leadId ?? "x", leadId, output: { recommendedAction: "Call" }, status: "COMPLETED" } })
        .then((r) => r.id);
    runA = await mk(a, leadA);
    runB = await mk(b, null);
  });

  after(async () => {
    await destroyTenant(a);
    await destroyTenant(b);
  });

  const review = (id: string, status: string) => call(REVIEW, "POST", { body: { id, status } });

  for (const role of ROLES) {
    it(`${role}: ${MANAGERS.includes(role as (typeof MANAGERS)[number]) ? "can" : "cannot"} review`, async () => {
      const run = await prisma.intelligenceRun.create({
        data: { workspaceId: a.workspaceId, kind: "LEAD_ANALYSIS", model: "d", promptVersion: "v1", entityType: "Lead", entityId: leadA, leadId: leadA, output: {}, status: "COMPLETED" },
      });
      actAs(a.users[role]);
      const res = await review(run.id, "APPROVED");
      assert.equal(res.status, MANAGERS.includes(role as (typeof MANAGERS)[number]) ? 200 : 403);
    });
  }

  it("approval stores status, reviewer and time, audits it, and never changes CRM records", async () => {
    actAs(a.users.MANAGER);
    const leadBefore = await prisma.lead.findUniqueOrThrow({ where: { id: leadA } });
    const res = await review(runA, "APPROVED");
    assert.equal(res.status, 200);
    assert.match(res.body.notice, /not auto-mutated/);
    const run = await prisma.intelligenceRun.findUniqueOrThrow({ where: { id: runA } });
    assert.equal(run.status, "APPROVED");
    assert.equal(run.reviewedById, a.users.MANAGER.id);
    assert.ok(run.reviewedAt);
    assert.equal(await prisma.auditLog.count({ where: { workspaceId: a.workspaceId, action: "INTELLIGENCE_APPROVED", entityId: runA } }), 1);
    const leadAfter = await prisma.lead.findUniqueOrThrow({ where: { id: leadA } });
    assert.equal(leadAfter.stage, leadBefore.stage);
    assert.equal(leadAfter.ownerId, leadBefore.ownerId);
    assert.equal(leadAfter.updatedAt.getTime(), leadBefore.updatedAt.getTime(), "the lead record was not touched");
  });

  it("a decision can be changed (approved -> rejected) and is audited as such", async () => {
    actAs(a.users.ADMIN);
    assert.equal((await review(runA, "REJECTED")).status, 200);
    assert.equal((await prisma.intelligenceRun.findUniqueOrThrow({ where: { id: runA } })).status, "REJECTED");
    assert.equal(await prisma.auditLog.count({ where: { workspaceId: a.workspaceId, action: "INTELLIGENCE_REJECTED", entityId: runA } }), 1);
  });

  it("rejects invalid statuses and unknown ids; another workspace's run is invisible (404) and untouched", async () => {
    actAs(a.users.OWNER);
    assert.equal((await review(runA, "COMPLETED")).status, 400);
    assert.equal((await review(runA, "")).status, 400);
    assert.equal((await review("does-not-exist", "APPROVED")).status, 404);
    assert.equal((await review(runB, "APPROVED")).status, 404);
    assert.equal((await prisma.intelligenceRun.findUniqueOrThrow({ where: { id: runB } })).status, "COMPLETED");
  });
});

describe("invitation state (Team screen data)", () => {
  let t: Tenant;
  const emails: string[] = [];
  const now = new Date("2026-10-04T00:00:00Z");
  const day = 86400000;

  before(async () => {
    installSessionMock();
    ({ POST: MEMBERS } = await import("../../src/app/api/workspace/members/route"));
    ({ POST: ACCEPT } = await import("../../src/app/api/auth/accept-invite/route"));
    t = await createTenant("invstate");
    actAs(t.users.OWNER);
  });

  after(async () => {
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await destroyTenant(t);
  });

  it("classifyInvitation: pending, expired, used, mixed and empty", () => {
    const later = new Date(now.getTime() + day);
    const earlier = new Date(now.getTime() - day);
    assert.deepEqual(classifyInvitation([], now), null);
    assert.deepEqual(classifyInvitation([{ expiresAt: later, usedAt: now }], now), null, "used link = setup finished");
    assert.equal(classifyInvitation([{ expiresAt: later, usedAt: null }], now)?.state, "PENDING");
    assert.equal(classifyInvitation([{ expiresAt: earlier, usedAt: null }], now)?.state, "EXPIRED");
    assert.equal(classifyInvitation([{ expiresAt: earlier, usedAt: null }, { expiresAt: later, usedAt: null }], now)?.state, "PENDING", "newest unused link wins");
    assert.equal(classifyInvitation([{ expiresAt: now, usedAt: null }], now)?.state, "EXPIRED", "expiry instant itself is expired");
  });

  it("follows the real lifecycle: invited = pending, lapsed = expired, re-issued = pending, accepted = none", async () => {
    const email = `inv-${randomUUID()}@example.test`;
    emails.push(email);
    const invited = await call(MEMBERS, "POST", { body: { email, name: "Lifecycle", role: "AGENT" } });
    assert.equal(invited.status, 200);
    const userId = invited.body.member.userId as string;
    const token1 = new URLSearchParams(invited.body.setupUrl.split("#")[1]).get("token")!;

    assert.equal((await invitationStatesFor([userId])).get(userId)?.state, "PENDING");

    await prisma.accountSetupToken.updateMany({ where: { tokenHash: hashSetupToken(token1) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await invitationStatesFor([userId])).get(userId)?.state, "EXPIRED");
    assert.equal((await call(ACCEPT, "POST", { body: { token: token1, password: "a long enough passphrase" }, headers: freshIp() })).status, 400, "expired link is refused");

    const reissued = await call(MEMBERS, "POST", { body: { email, name: "Lifecycle", role: "AGENT" } });
    assert.equal(reissued.status, 200);
    assert.ok(reissued.body.setupUrl);
    assert.equal((await invitationStatesFor([userId])).get(userId)?.state, "PENDING");

    const token2 = new URLSearchParams(reissued.body.setupUrl.split("#")[1]).get("token")!;
    assert.equal((await call(ACCEPT, "POST", { body: { token: token2, password: "a long enough passphrase" }, headers: freshIp() })).status, 200);
    assert.equal((await invitationStatesFor([userId])).has(userId), false, "accepted: no invitation state");
  });

  it("members without a setup link (existing/seeded users) have no invitation state", async () => {
    const states = await invitationStatesFor(Object.values(t.users).map((u) => u.id));
    assert.equal(states.size, 0);
  });
});
