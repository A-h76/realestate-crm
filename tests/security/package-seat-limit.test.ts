import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/lib/db";
import { actAs, call, createTenant, destroyTenant, installSessionMock, type Tenant } from "../helpers/http";

/** The sold package caps team size. createTenant makes 5 members (one per role) = a full Growth workspace. */
describe("Package seat limit", () => {
  let tenant: Tenant;
  let INVITE: Parameters<typeof call>[0];
  const emails: string[] = [];
  const invite = () => {
    const email = `seat-${randomUUID()}@example.test`;
    emails.push(email);
    return call(INVITE, "POST", { body: { email, name: "Extra Person", role: "AGENT" } });
  };

  before(async () => {
    installSessionMock();
    ({ POST: INVITE } = await import("../../src/app/api/workspace/members/route"));
    tenant = await createTenant("seat-limit");
    actAs(tenant.users.OWNER);
  });

  after(async () => {
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await destroyTenant(tenant);
  });

  it("Starter refuses a new member beyond 3 with a plain message", async () => {
    await prisma.workspace.update({ where: { id: tenant.workspaceId }, data: { package: "starter" } });
    const res = await invite();
    assert.equal(res.status, 403);
    assert.match(JSON.stringify(res.body), /Starter package includes up to 3 team members/);
  });

  it("Growth refuses a 6th member with a plain message", async () => {
    await prisma.workspace.update({ where: { id: tenant.workspaceId }, data: { package: "growth" } });
    const res = await invite();
    assert.equal(res.status, 403);
    assert.match(JSON.stringify(res.body), /up to 5 team members/);
  });

  it("Advanced has no package seat limit", async () => {
    await prisma.workspace.update({ where: { id: tenant.workspaceId }, data: { package: "advanced" } });
    const res = await invite();
    assert.equal(res.status, 200, JSON.stringify(res.body));
  });
});
