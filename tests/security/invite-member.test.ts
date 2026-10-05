import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/lib/db";
import { hashSetupToken } from "../../src/lib/workspace/account-setup";
import {
  actAs,
  call,
  createTenant,
  destroyTenant,
  freshIp,
  installSessionMock,
  type Tenant,
} from "../helpers/http";

/**
 * CORE-002: adding a team member through the HTTP API. New people never receive a server-chosen
 * password: they follow a one-time, expiring, hashed-at-rest link and set their own.
 */
type Handler = Parameters<typeof call>[0];
let INVITE: Handler;
let ACCEPT: Handler;

const PASSWORD = "correct horse battery staple";
const tokenOf = (setupUrl: string) => new URLSearchParams(setupUrl.split("#")[1]).get("token")!;

describe("Team member invitation (HTTP)", () => {
  let tenant: Tenant;
  let other: Tenant;
  const emails: string[] = [];
  const newEmail = () => {
    const email = `invitee-${randomUUID()}@example.test`;
    emails.push(email);
    return email;
  };
  const invite = (body: Record<string, unknown>) => call(INVITE, "POST", { body });
  const accept = (token: string, password = PASSWORD) =>
    call(ACCEPT, "POST", { body: { token, password }, headers: freshIp() });

  before(async () => {
    installSessionMock();
    ({ POST: INVITE } = await import("../../src/app/api/workspace/members/route"));
    ({ POST: ACCEPT } = await import("../../src/app/api/auth/accept-invite/route"));
    tenant = await createTenant("invite");
    other = await createTenant("invite-other");
  });

  after(async () => {
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await destroyTenant(tenant);
    await destroyTenant(other);
  });

  describe("who may invite", () => {
    for (const role of ["OWNER", "ADMIN"] as const) {
      it(`${role} can add a member`, async () => {
        actAs(tenant.users[role]);
        const res = await invite({ email: newEmail(), name: "New Person", role: "AGENT" });
        assert.equal(res.status, 200, JSON.stringify(res.body));
      });
    }
    for (const role of ["MANAGER", "AGENT", "VIEWER"] as const) {
      it(`${role} is refused (403) and nothing is created`, async () => {
        actAs(tenant.users[role]);
        const email = newEmail();
        const res = await invite({ email, name: "Nope", role: "AGENT" });
        assert.equal(res.status, 403);
        assert.equal(await prisma.user.count({ where: { email } }), 0);
      });
    }
    it("unauthenticated requests get 401", async () => {
      actAs(null);
      assert.equal((await invite({ email: newEmail(), name: "Anon", role: "AGENT" })).status, 401);
    });
  });

  describe("validation", () => {
    it("rejects bad email, empty name, unknown role, and OWNER escalation", async () => {
      actAs(tenant.users.OWNER);
      for (const body of [
        { email: "not-an-email", name: "X", role: "AGENT" },
        { email: newEmail(), name: "", role: "AGENT" },
        { email: newEmail(), name: "X", role: "SUPERUSER" },
        { email: newEmail(), name: "X", role: "OWNER" },
        { email: newEmail(), name: "X" },
      ]) {
        assert.equal((await invite(body)).status, 400, JSON.stringify(body));
      }
    });
  });

  describe("new account", () => {
    it("never returns or stores a password; the link token is stored only as a hash", async () => {
      actAs(tenant.users.OWNER);
      const email = newEmail();
      const res = await invite({ email, name: "Fresh Hire", role: "MANAGER" });
      assert.equal(res.status, 200);
      assert.match(res.body.setupUrl, /\/accept-invite#token=/, "token travels in the URL fragment");
      assert.ok(!JSON.stringify(res.body).toLowerCase().includes("password"));
      const token = tokenOf(res.body.setupUrl);

      const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { memberships: true, setupTokens: true } });
      assert.equal(user.memberships.length, 1);
      assert.equal(user.memberships[0].role, "MANAGER");
      assert.equal(user.memberships[0].workspaceId, tenant.workspaceId);
      assert.equal(user.setupTokens.length, 1);
      assert.equal(user.setupTokens[0].tokenHash, hashSetupToken(token));
      assert.notEqual(user.setupTokens[0].tokenHash, token);
      assert.ok(user.setupTokens[0].expiresAt.getTime() > Date.now() + 71 * 3600_000, "~72h expiry");
      assert.equal(await bcrypt.compare(token, user.passwordHash), false);
      assert.equal(await bcrypt.compare("", user.passwordHash), false);

      const audits = await prisma.auditLog.findMany({ where: { workspaceId: tenant.workspaceId, action: "MEMBER_INVITED", entityId: user.memberships[0].id } });
      assert.equal(audits.length, 1);
      assert.ok(!JSON.stringify(audits[0].metadata).includes(token), "token must not reach the audit log");
    });

    it("the member sets their own password with the link; it works exactly once", async () => {
      actAs(tenant.users.OWNER);
      const email = newEmail();
      const token = tokenOf((await invite({ email, name: "Setter", role: "AGENT" })).body.setupUrl);

      const short = await accept(token, "short");
      assert.equal(short.status, 400);
      const ok = await accept(token);
      assert.equal(ok.status, 200);
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      assert.equal(await bcrypt.compare(PASSWORD, user.passwordHash), true);

      const replay = await accept(token, "another long passphrase!");
      assert.equal(replay.status, 400);
      assert.equal(await bcrypt.compare(PASSWORD, (await prisma.user.findUniqueOrThrow({ where: { email } })).passwordHash), true, "replay must not change the password");

      const audit = await prisma.auditLog.count({ where: { workspaceId: tenant.workspaceId, action: "MEMBER_INVITE_ACCEPTED", actorId: user.id } });
      assert.equal(audit, 1);
    });

    it("unknown, malformed and expired links all fail with the same generic message", async () => {
      actAs(tenant.users.OWNER);
      const email = newEmail();
      const token = tokenOf((await invite({ email, name: "Late", role: "AGENT" })).body.setupUrl);
      await prisma.accountSetupToken.updateMany({ where: { tokenHash: hashSetupToken(token) }, data: { expiresAt: new Date(Date.now() - 1000) } });

      const messages = new Set<string>();
      for (const t of [token, "x".repeat(43), "short-token-value-0123456789"]) {
        const res = await accept(t);
        assert.equal(res.status, 400);
        messages.add(res.body.error);
      }
      assert.equal(messages.size, 1);
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      assert.equal(await bcrypt.compare(PASSWORD, user.passwordHash), false);
    });

    it("two concurrent submissions of one link: exactly one succeeds", async () => {
      actAs(tenant.users.OWNER);
      const token = tokenOf((await invite({ email: newEmail(), name: "Racer", role: "AGENT" })).body.setupUrl);
      const results = await Promise.all([accept(token, "first racing passphrase"), accept(token, "second racing passphrase")]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
    });

    it("re-inviting a member who has not finished setup re-issues the link and kills the old one", async () => {
      actAs(tenant.users.OWNER);
      const email = newEmail();
      const first = tokenOf((await invite({ email, name: "Pending", role: "AGENT" })).body.setupUrl);
      const again = await invite({ email, name: "Pending", role: "AGENT" });
      assert.equal(again.status, 200);
      const second = tokenOf(again.body.setupUrl);
      assert.notEqual(first, second);
      assert.equal((await accept(first)).status, 400);
      assert.equal((await accept(second)).status, 200);
      // Setup finished: now it is a normal duplicate.
      assert.equal((await invite({ email, name: "Pending", role: "AGENT" })).status, 400);
    });

    it("acceptance revokes any live sessions of the account", async () => {
      actAs(tenant.users.OWNER);
      const email = newEmail();
      const token = tokenOf((await invite({ email, name: "Sessions", role: "AGENT" })).body.setupUrl);
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      const session = await prisma.authSession.create({ data: { id: randomUUID(), userId: user.id, expiresAt: new Date(Date.now() + 3600_000) } });
      await accept(token);
      assert.ok((await prisma.authSession.findUniqueOrThrow({ where: { id: session.id } })).revokedAt);
    });
  });

  describe("existing account", () => {
    it("adds the membership only: no link, no data about the other account in the response", async () => {
      const existing = other.users.AGENT;
      actAs(tenant.users.ADMIN);
      const res = await invite({ email: existing.email, name: "Different Name", role: "VIEWER" });
      assert.equal(res.status, 200);
      assert.equal(res.body.setupUrl, null);
      assert.ok(!JSON.stringify(res.body).includes(existing.name));
      const membership = await prisma.workspaceMember.findUniqueOrThrow({
        where: { workspaceId_userId: { workspaceId: tenant.workspaceId, userId: existing.id } },
      });
      assert.equal(membership.role, "VIEWER");
      assert.equal(await prisma.accountSetupToken.count({ where: { userId: existing.id } }), 0);
      // Their original workspace membership is untouched.
      const original = await prisma.workspaceMember.findUniqueOrThrow({
        where: { workspaceId_userId: { workspaceId: other.workspaceId, userId: existing.id } },
      });
      assert.equal(original.role, "AGENT");
    });

    it("rejects a duplicate membership and a deactivated account", async () => {
      actAs(tenant.users.OWNER);
      assert.equal((await invite({ email: tenant.users.AGENT.email, name: "Dup", role: "AGENT" })).status, 400);
      const gone = other.users.VIEWER;
      await prisma.user.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });
      assert.equal((await invite({ email: gone.email, name: "Gone", role: "AGENT" })).status, 400);
    });
  });

  describe("accept-invite endpoint abuse limits", () => {
    it("is rate limited per IP", async () => {
      const headers = freshIp();
      let limited = 0;
      for (let i = 0; i < 12; i++) {
        const res = await call(ACCEPT, "POST", { body: { token: "t".repeat(43), password: PASSWORD }, headers });
        if (res.status === 429) limited++;
      }
      assert.ok(limited >= 1, "expected at least one 429 after 10 attempts from one IP");
    });
  });
});
