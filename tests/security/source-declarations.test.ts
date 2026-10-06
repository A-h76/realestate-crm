import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/lib/db";
import { actAs, call, createTenant, destroyTenant, installSessionMock, type Tenant } from "../helpers/http";

/** Declaring lead sources: only workspace:write roles may change it, and every real change leaves one audit row. */
describe("PUT /api/workspace/sources", () => {
  let tenant: Tenant;
  let route: Record<string, Parameters<typeof call>[0]>;
  const audits = () =>
    prisma.auditLog.findMany({ where: { workspaceId: tenant.workspaceId, action: "SOURCES_DECLARED" }, orderBy: { createdAt: "asc" } });
  const declared = async () =>
    (await prisma.sourceDeclaration.findMany({ where: { workspaceId: tenant.workspaceId } })).map((d) => d.source).sort();

  before(async () => {
    installSessionMock();
    tenant = await createTenant("sources");
    route = await import("../../src/app/api/workspace/sources/route");
  });

  after(async () => {
    await destroyTenant(tenant);
  });

  it("roles without workspace:write get 403 and change nothing", async () => {
    for (const role of ["MANAGER", "AGENT", "VIEWER"] as const) {
      actAs(tenant.users[role]);
      assert.equal((await call(route.PUT, "PUT", { body: { sources: ["ZILLOW"] } })).status, 403, role);
    }
    assert.deepEqual(await declared(), []);
    assert.equal((await audits()).length, 0);
  });

  it("each real change is audited with who, what was added and what was removed; a no-op save is not", async () => {
    actAs(tenant.users.OWNER);
    const first = await call(route.PUT, "PUT", { body: { sources: ["ZILLOW", "WEB_FORM", "ZILLOW"] } });
    assert.equal(first.status, 200);
    assert.equal(first.body.declaredCount, 2);
    assert.deepEqual(await declared(), ["WEB_FORM", "ZILLOW"]);

    assert.equal((await call(route.PUT, "PUT", { body: { sources: ["WEB_FORM", "ZILLOW"] } })).status, 200);
    assert.equal((await audits()).length, 1, "unchanged list writes no audit row");

    actAs(tenant.users.ADMIN);
    assert.equal((await call(route.PUT, "PUT", { body: { sources: ["ZILLOW", "WHATSAPP_INBOUND"] } })).status, 200);
    assert.deepEqual(await declared(), ["WHATSAPP_INBOUND", "ZILLOW"]);

    const rows = await audits();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].actorId, tenant.users.OWNER.id);
    assert.equal(rows[0].actorType, "USER");
    assert.equal(rows[0].fromState, null);
    assert.equal(rows[0].toState, "WEB_FORM,ZILLOW");
    assert.deepEqual(rows[1].metadata, { added: ["WHATSAPP_INBOUND"], removed: ["WEB_FORM"] });
    assert.equal(rows[1].actorId, tenant.users.ADMIN.id);
    assert.equal(rows[1].fromState, "WEB_FORM,ZILLOW");
  });

  it("clearing every source is a change and is audited", async () => {
    actAs(tenant.users.OWNER);
    assert.equal((await call(route.PUT, "PUT", { body: { sources: [] } })).status, 200);
    assert.deepEqual(await declared(), []);
    const last = (await audits()).at(-1)!;
    assert.equal(last.toState, null);
  });

  it("rejects an unknown source", async () => {
    actAs(tenant.users.OWNER);
    assert.equal((await call(route.PUT, "PUT", { body: { sources: ["MLS_FEED"] } })).status, 400);
  });
});
