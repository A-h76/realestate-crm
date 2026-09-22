import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/lib/db";
import { verifyLoginCredentials } from "../../src/lib/auth";

describe("verifyLoginCredentials", () => {
  const email = `auth-test-${randomUUID()}@example.com`;
  const password = "correct-horse-battery-staple";
  let workspaceId: string;

  before(async () => {
    const password_hash = await bcrypt.hash(password, 10);
    const workspace = await prisma.workspace.create({
      data: { name: "Auth Test Workspace", slug: `auth-test-${randomUUID()}` },
    });
    workspaceId = workspace.id;
    const user = await prisma.user.create({
      data: { email, name: "Auth Test User", passwordHash: password_hash },
    });
    await prisma.workspaceMember.create({
      data: { workspaceId, userId: user.id, role: "AGENT" },
    });
  });

  after(async () => {
    await prisma.workspace.delete({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { email } });
  });

  it("denies malformed input without touching the database", async () => {
    const result = await verifyLoginCredentials({ email: "not-an-email", password: "" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_input");
  });

  it("denies an unknown email", async () => {
    const result = await verifyLoginCredentials({ email: "nobody@example.com", password: "whatever" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "unknown_user");
  });

  it("denies a wrong password", async () => {
    const result = await verifyLoginCredentials({ email, password: "wrong-password" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "bad_password");
  });

  it("accepts correct credentials and resolves the workspace membership", async () => {
    const result = await verifyLoginCredentials({ email, password });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.user.email, email);
      assert.equal(result.user.workspaceId, workspaceId);
      assert.equal(result.user.role, "AGENT");
    }
  });
});
