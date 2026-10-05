import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/lib/db";
import { convertLeadOnOpportunityWon } from "../../src/lib/leads/convert-on-won";
import { actAs, call, createTenant, destroyTenant, installSessionMock, type Tenant } from "../helpers/http";

/**
 * DATA-004 / DATA-005 / TEST-004: stage changes are one transaction (stage + activity + audit +
 * property status + lead conversion), serialize per opportunity, honour an optimistic
 * `expectedStageId`, and lead conversion happens exactly once however it is triggered.
 */
type Handler = Parameters<typeof call>[0];
let PATCH_OPP: Handler;

describe("Opportunity stage changes: atomicity and concurrency", () => {
  let tenant: Tenant;
  let other: Tenant;

  before(async () => {
    installSessionMock();
    ({ PATCH: PATCH_OPP } = await import("../../src/app/api/opportunities/[id]/route"));
    tenant = await createTenant("oppconc");
    other = await createTenant("oppconc-other");
    actAs(tenant.users.AGENT);
  });

  after(async () => {
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS fail_conversion ON "Lead"');
    await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS fail_conversion_fn()");
    await destroyTenant(tenant);
    await destroyTenant(other);
  });

  const createOpp = (extra: Record<string, unknown> = {}) =>
    prisma.opportunity.create({
      data: { workspaceId: tenant.workspaceId, name: "Deal", dealSide: "BUYER", value: 100, stageId: tenant.stages.open, ...extra },
    });
  const move = (id: string, stageId: string, expectedStageId?: string) =>
    call(PATCH_OPP, "PATCH", { params: { id }, body: { stageId, ...(expectedStageId ? { expectedStageId } : {}) } });
  const stageChanges = (opportunityId: string) =>
    prisma.activity.count({ where: { workspaceId: tenant.workspaceId, opportunityId, type: "STAGE_CHANGE" } });

  it("expectedStageId: a stale client gets 409 with the current stage and nothing changes", async () => {
    const opp = await createOpp();
    assert.equal((await move(opp.id, tenant.stages.open2, tenant.stages.open)).status, 200);
    const stale = await move(opp.id, tenant.stages.won, tenant.stages.open);
    assert.equal(stale.status, 409);
    assert.equal(stale.body.currentStageId, tenant.stages.open2);
    assert.equal((await prisma.opportunity.findUniqueOrThrow({ where: { id: opp.id } })).stageId, tenant.stages.open2);
    assert.equal(await stageChanges(opp.id), 1, "the rejected move left no activity");
  });

  it("two clients both moving from the same stage: one wins, the other is told it is stale", async () => {
    for (let i = 0; i < 4; i++) {
      const opp = await createOpp();
      const results = await Promise.all([
        move(opp.id, tenant.stages.open2, tenant.stages.open),
        move(opp.id, tenant.stages.lost, tenant.stages.open),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
      assert.equal(await stageChanges(opp.id), 1);
    }
  });

  it("an identical move submitted twice at once is applied once (no duplicate activity, audit or task)", async () => {
    await prisma.automation.create({
      data: { workspaceId: tenant.workspaceId, name: "stage task", trigger: "STAGE_CHANGED", enabled: true, paused: false, actions: [{ type: "CREATE_TASK", title: "After stage", priority: "LOW", dueInDays: 1 }] },
    });
    const opp = await createOpp();
    const results = await Promise.all([move(opp.id, tenant.stages.open2), move(opp.id, tenant.stages.open2), move(opp.id, tenant.stages.open2)]);
    assert.ok(results.every((r) => r.status === 200));
    assert.equal(await stageChanges(opp.id), 1);
    assert.equal(await prisma.auditLog.count({ where: { workspaceId: tenant.workspaceId, entityId: opp.id, action: "OPPORTUNITY_STAGE_CHANGED" } }), 1);
    assert.equal(await prisma.task.count({ where: { workspaceId: tenant.workspaceId, opportunityId: opp.id } }), 1);
  });

  it("unconditional concurrent moves serialize: final stage is the last audited one and history is complete", async () => {
    for (let i = 0; i < 4; i++) {
      const opp = await createOpp();
      await Promise.all([move(opp.id, tenant.stages.open2), move(opp.id, tenant.stages.won), move(opp.id, tenant.stages.lost)]);
      const final = await prisma.opportunity.findUniqueOrThrow({ where: { id: opp.id } });
      const lastAudit = await prisma.auditLog.findFirstOrThrow({
        where: { workspaceId: tenant.workspaceId, entityId: opp.id, action: "OPPORTUNITY_STAGE_CHANGED" },
        orderBy: { createdAt: "desc" },
      });
      assert.equal((lastAudit.metadata as { toStageId: string }).toStageId, final.stageId);
      assert.equal(await stageChanges(opp.id), 3, "every accepted move is recorded exactly once");
    }
  });

  it("rejects inactive, foreign and unknown stages without touching the opportunity", async () => {
    const opp = await createOpp();
    const inactive = await prisma.pipelineStage.create({ data: { workspaceId: tenant.workspaceId, name: "old", slug: "old", order: 9, active: false } });
    for (const stageId of [inactive.id, other.stages.open, "does-not-exist"]) {
      const res = await move(opp.id, stageId);
      assert.equal(res.status, 400, stageId);
    }
    assert.equal((await prisma.opportunity.findUniqueOrThrow({ where: { id: opp.id } })).stageId, tenant.stages.open);
    assert.equal(await stageChanges(opp.id), 0);
  });

  it("a failure after the stage write rolls the whole move back (stage, activity, audit, property, lead)", async () => {
    const lead = await prisma.lead.create({ data: { workspaceId: tenant.workspaceId, firstName: "Rollback", stage: "QUALIFIED" } });
    const property = await prisma.property.create({
      data: { workspaceId: tenant.workspaceId, title: "RB", propertyType: "SINGLE_FAMILY", purpose: "SALE", price: 1, city: "Chicago" },
    });
    const opp = await createOpp({ leadId: lead.id, linkedPropertyId: property.id });
    // Force the lead conversion (the LAST write in the transaction) to fail for this workspace only.
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION fail_conversion_fn() RETURNS trigger AS $$
      BEGIN IF NEW."stage" = 'CONVERTED' AND NEW."workspaceId" = '${tenant.workspaceId}' THEN RAISE EXCEPTION 'forced failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe('CREATE TRIGGER fail_conversion BEFORE UPDATE ON "Lead" FOR EACH ROW EXECUTE FUNCTION fail_conversion_fn()');
    try {
      const res = await move(opp.id, tenant.stages.won);
      assert.equal(res.status, 500);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER fail_conversion ON "Lead"');
    }
    assert.equal((await prisma.opportunity.findUniqueOrThrow({ where: { id: opp.id } })).stageId, tenant.stages.open, "stage not moved");
    assert.equal(await stageChanges(opp.id), 0, "no activity");
    assert.equal(await prisma.auditLog.count({ where: { workspaceId: tenant.workspaceId, entityId: opp.id } }), 0, "no audit");
    assert.equal((await prisma.property.findUniqueOrThrow({ where: { id: property.id } })).status, "AVAILABLE", "property untouched");
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).stage, "QUALIFIED", "lead untouched");
    // And with the fault removed the very same request succeeds, proving it was the rollback, not a broken request.
    assert.equal((await move(opp.id, tenant.stages.won)).status, 200);
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).stage, "CONVERTED");
  });
});

describe("Lead conversion (DATA-005)", () => {
  let tenant: Tenant;

  before(async () => {
    installSessionMock();
    tenant = await createTenant("leadconv");
    actAs(tenant.users.AGENT);
  });

  after(async () => {
    await destroyTenant(tenant);
  });

  it("concurrent conversions of one lead transition once and write one audit row", async () => {
    for (let i = 0; i < 4; i++) {
      const lead = await prisma.lead.create({ data: { workspaceId: tenant.workspaceId, firstName: "Conv", stage: "QUALIFIED" } });
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, k) => convertLeadOnOpportunityWon({ workspaceId: tenant.workspaceId, actorId: null, leadId: lead.id, opportunityId: `opp-${k}` })),
      );
      assert.equal(results.filter(Boolean).length, 1);
      assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).stage, "CONVERTED");
      assert.equal(await prisma.auditLog.count({ where: { workspaceId: tenant.workspaceId, entityId: lead.id, action: "LEAD_STAGE_CHANGED" } }), 1);
    }
  });

  it("two opportunities of the same lead won at the same moment convert the lead once", async () => {
    const { PATCH } = await import("../../src/app/api/opportunities/[id]/route");
    const lead = await prisma.lead.create({ data: { workspaceId: tenant.workspaceId, firstName: "TwoDeals", stage: "QUALIFIED" } });
    const [a, b] = await Promise.all(
      [1, 2].map(() => prisma.opportunity.create({ data: { workspaceId: tenant.workspaceId, name: "d", dealSide: "BUYER", value: 1, stageId: tenant.stages.open, leadId: lead.id } })),
    );
    const results = await Promise.all([a, b].map((o) => call(PATCH, "PATCH", { params: { id: o.id }, body: { stageId: tenant.stages.won } })));
    assert.deepEqual(results.map((r) => r.status), [200, 200]);
    assert.equal(await prisma.auditLog.count({ where: { workspaceId: tenant.workspaceId, entityId: lead.id, action: "LEAD_STAGE_CHANGED" } }), 1);
  });

  it("converting a missing, deleted or other-workspace lead is a no-op", async () => {
    const other = await createTenant("leadconv-other");
    try {
      const foreign = await prisma.lead.create({ data: { workspaceId: other.workspaceId, firstName: "Foreign", stage: "QUALIFIED" } });
      assert.equal(await convertLeadOnOpportunityWon({ workspaceId: tenant.workspaceId, actorId: null, leadId: foreign.id, opportunityId: "x" }), false);
      assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: foreign.id } })).stage, "QUALIFIED");
      const deleted = await prisma.lead.create({ data: { workspaceId: tenant.workspaceId, firstName: "Gone", stage: "QUALIFIED", deletedAt: new Date() } });
      assert.equal(await convertLeadOnOpportunityWon({ workspaceId: tenant.workspaceId, actorId: null, leadId: deleted.id, opportunityId: "x" }), false);
      assert.equal(await convertLeadOnOpportunityWon({ workspaceId: tenant.workspaceId, actorId: null, leadId: "missing", opportunityId: "x" }), false);
    } finally {
      await destroyTenant(other);
    }
  });
});
