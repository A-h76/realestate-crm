import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/lib/db";
import { actAs, call, createTenant, destroyTenant, freshIp, installSessionMock, type Tenant } from "../helpers/http";

/** The CSV receivedAt column reaches the Lead row; a lead without one keeps receivedAt = null (clock falls back to createdAt). */
describe("CSV import receivedAt", () => {
  let tenant: Tenant;
  let route: { POST: Parameters<typeof call>[0] };

  before(async () => {
    installSessionMock();
    tenant = await createTenant("csv-received");
    route = await import("../../src/app/api/leads/csv/route");
  });

  after(async () => {
    await destroyTenant(tenant);
  });

  it("stores receivedAt from the file and leaves it null when the column or cell is empty", async () => {
    actAs(tenant.users.AGENT);
    const csv = [
      "firstName,email,receivedAt",
      "Old,old@recv.example,2026-09-01T09:00:00Z",
      "Blank,blank@recv.example,",
    ].join("\n");
    const res = await call(route.POST, "POST", { rawBody: csv, headers: { "content-type": "text/csv", ...freshIp() } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const leads = await prisma.lead.findMany({ where: { workspaceId: tenant.workspaceId }, orderBy: { firstName: "asc" } });
    const by = Object.fromEntries(leads.map((l) => [l.firstName, l]));
    assert.equal(by.Old.receivedAt?.toISOString(), "2026-09-01T09:00:00.000Z");
    assert.ok(by.Old.createdAt > by.Old.receivedAt!, "createdAt stays the import time");
    assert.equal(by.Blank.receivedAt, null);
  });

  it("a bad receivedAt is reported on its row and that row is not imported", async () => {
    actAs(tenant.users.AGENT);
    const csv = ["firstName,email,receivedAt", "Bad,bad@recv.example,last week"].join("\n");
    const res = await call(route.POST, "POST", { rawBody: csv, headers: { "content-type": "text/csv", ...freshIp() } });
    assert.equal(await prisma.lead.count({ where: { workspaceId: tenant.workspaceId, firstName: "Bad" } }), 0);
    assert.match(JSON.stringify(res.body), /receivedAt/);
  });
});
