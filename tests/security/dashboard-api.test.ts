import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startOfMonth } from "date-fns";
import { prisma } from "../../src/lib/db";
import { getPipelineMetrics } from "../../src/lib/metrics/pipeline";
import { actAs, call, createTenant, destroyTenant, installSessionMock, ROLES, type Tenant } from "../helpers/http";

/**
 * CORE-001: /api/dashboard reports exactly what the shared aggregation (getPipelineMetrics) returns
 * for the same workspace and month-to-date window. The dashboard page calls the same function with
 * `wonSince: startOfMonth(now)`; it is a server component and is not executed here, so page/API
 * parity rests on both call sites using this one function (see the call sites in
 * src/app/(app)/dashboard/page.tsx and src/app/api/dashboard/route.ts).
 */
type Handler = Parameters<typeof call>[0];
let GET_DASHBOARD: Handler;

describe("GET /api/dashboard vs getPipelineMetrics", () => {
  let tenant: Tenant;
  let other: Tenant;

  before(async () => {
    installSessionMock();
    ({ GET: GET_DASHBOARD } = await import("../../src/app/api/dashboard/route"));
    tenant = await createTenant("dash");
    other = await createTenant("dash-other");

    const opp = (t: Tenant, stageId: string, value: number, extra: Record<string, unknown> = {}) =>
      prisma.opportunity.create({
        data: { workspaceId: t.workspaceId, name: "d", dealSide: "BUYER", value, stageId, ...extra },
      });
    // open stage probability 20, open2 probability 60
    await opp(tenant, tenant.stages.open, 1_000_000, { probability: 0 }); // falls back to stage 20% -> 200k
    await opp(tenant, tenant.stages.open2, 500_000, { probability: 50 }); // own 50% -> 250k
    await opp(tenant, tenant.stages.open, 999, { deletedAt: new Date() }); // soft-deleted: excluded
    await opp(tenant, tenant.stages.won, 300_000); // won this month
    await opp(tenant, tenant.stages.won, 700_000, { stageEnteredAt: new Date(Date.now() - 90 * 86400000) }); // old win
    await opp(other, other.stages.open, 123_456_789); // other workspace: excluded
    await opp(other, other.stages.won, 987_654_321);
  });

  after(async () => {
    await destroyTenant(tenant);
    await destroyTenant(other);
  });

  it("returns the same pipeline, weighted-pipeline and won-revenue figures as the shared function", async () => {
    actAs(tenant.users.AGENT);
    const res = await call(GET_DASHBOARD, "GET");
    assert.equal(res.status, 200);
    const shared = await getPipelineMetrics(tenant.workspaceId, { wonSince: startOfMonth(new Date()) });
    assert.equal(res.body.metrics.pipelineValue, shared.pipelineValue);
    assert.equal(res.body.metrics.weightedPipeline, shared.weightedPipeline);
    assert.equal(res.body.metrics.wonRevenue, shared.wonRevenue);
    assert.equal(res.body.metrics.openOpportunities, shared.openCount);
  });

  it("matches hand-computed expectations: month-to-date won, stage-probability fallback, tenant + soft-delete scoping", async () => {
    actAs(tenant.users.OWNER);
    const { metrics } = (await call(GET_DASHBOARD, "GET")).body;
    assert.equal(metrics.pipelineValue, 1_500_000);
    assert.equal(metrics.weightedPipeline, 450_000);
    assert.equal(metrics.openOpportunities, 2);
    assert.equal(metrics.wonRevenue, 300_000, "the 90-day-old win is outside month-to-date");
  });

  it("every role that can read the CRM sees identical numbers", async () => {
    const seen = new Set<string>();
    for (const role of ROLES) {
      actAs(tenant.users[role]);
      const res = await call(GET_DASHBOARD, "GET");
      assert.equal(res.status, 200, role);
      const { pipelineValue, weightedPipeline, wonRevenue } = res.body.metrics;
      seen.add(JSON.stringify({ pipelineValue, weightedPipeline, wonRevenue }));
    }
    assert.equal(seen.size, 1);
  });

  it("the other workspace's figures are its own", async () => {
    actAs(other.users.OWNER);
    const { metrics } = (await call(GET_DASHBOARD, "GET")).body;
    assert.equal(metrics.pipelineValue, 123_456_789);
    assert.equal(metrics.wonRevenue, 987_654_321);
  });
});
