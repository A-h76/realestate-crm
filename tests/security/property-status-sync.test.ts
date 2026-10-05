import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/lib/db";
import { actAs, call, createTenant, destroyTenant, installSessionMock, type Tenant } from "../helpers/http";

/**
 * DATA-003: Property.status must follow its Won/Lost opportunities, exercised through the
 * real route handlers (HTTP boundary). Invariant under test: a property is SOLD/RENTED iff an
 * active (non-deleted) Won opportunity holds it, and at most one opportunity can hold it.
 */
type Handler = Parameters<typeof call>[0];
let PATCH_OPP: Handler;
let DELETE_OPP: Handler;
let POST_OPP: Handler;

describe("Property status follows opportunity outcome (HTTP)", () => {
  let tenant: Tenant;

  before(async () => {
    installSessionMock();
    ({ PATCH: PATCH_OPP, DELETE: DELETE_OPP } = await import("../../src/app/api/opportunities/[id]/route"));
    ({ POST: POST_OPP } = await import("../../src/app/api/opportunities/route"));
    tenant = await createTenant("propsync");
    actAs(tenant.users.AGENT);
  });

  after(async () => {
    await destroyTenant(tenant);
  });

  const createProperty = (purpose: "SALE" | "RENT" = "SALE", status: "AVAILABLE" | "RESERVED" = "AVAILABLE") =>
    prisma.property.create({
      data: { workspaceId: tenant.workspaceId, title: "P", propertyType: "SINGLE_FAMILY", purpose, price: 1_000_000, status, city: "Chicago" },
    });

  const createOpp = (propertyId: string | null, stageId = tenant.stages.open, leadId: string | null = null) =>
    prisma.opportunity.create({
      data: {
        workspaceId: tenant.workspaceId,
        name: "Deal",
        dealSide: "BUYER",
        value: 100,
        stageId,
        linkedPropertyId: propertyId,
        leadId,
      },
    });

  const moveTo = (oppId: string, stageId: string) =>
    call(PATCH_OPP, "PATCH", { params: { id: oppId }, body: { stageId } });

  const statusOf = async (propertyId: string) =>
    (await prisma.property.findUniqueOrThrow({ where: { id: propertyId } })).status;

  it("SALE property becomes SOLD and RENT property becomes RENTED when won", async () => {
    const sale = await createProperty("SALE");
    const rent = await createProperty("RENT");
    assert.equal((await moveTo((await createOpp(sale.id)).id, tenant.stages.won)).status, 200);
    assert.equal((await moveTo((await createOpp(rent.id)).id, tenant.stages.won)).status, 200);
    assert.equal(await statusOf(sale.id), "SOLD");
    assert.equal(await statusOf(rent.id), "RENTED");
  });

  it("returns to AVAILABLE when the won deal is moved to Lost or reopened", async () => {
    for (const target of [tenant.stages.lost, tenant.stages.open]) {
      const property = await createProperty();
      const opp = await createOpp(property.id);
      await moveTo(opp.id, tenant.stages.won);
      assert.equal(await statusOf(property.id), "SOLD");
      await moveTo(opp.id, target);
      assert.equal(await statusOf(property.id), "AVAILABLE");
    }
  });

  it("leaves the property alone on open→open and open→lost moves, and never overrides a manual RESERVED", async () => {
    const property = await createProperty("SALE", "RESERVED");
    const opp = await createOpp(property.id);
    await moveTo(opp.id, tenant.stages.open2);
    await moveTo(opp.id, tenant.stages.lost);
    assert.equal(await statusOf(property.id), "RESERVED");
  });

  it("rejects a second Won opportunity on an already-sold property (409) without changing state", async () => {
    const property = await createProperty();
    const first = await createOpp(property.id);
    const second = await createOpp(property.id);
    assert.equal((await moveTo(first.id, tenant.stages.won)).status, 200);
    const res = await moveTo(second.id, tenant.stages.won);
    assert.equal(res.status, 409);
    assert.equal(await statusOf(property.id), "SOLD");
    const reloaded = await prisma.opportunity.findUniqueOrThrow({ where: { id: second.id } });
    assert.equal(reloaded.stageId, tenant.stages.open, "the rejected move must not be applied");
  });

  it("does not free a property when a different opportunity on it is lost or reopened", async () => {
    const property = await createProperty();
    const winner = await createOpp(property.id);
    const loser = await createOpp(property.id);
    await moveTo(winner.id, tenant.stages.won);
    await moveTo(loser.id, tenant.stages.lost);
    assert.equal(await statusOf(property.id), "SOLD");
    await moveTo(loser.id, tenant.stages.open);
    assert.equal(await statusOf(property.id), "SOLD");
    await moveTo(winner.id, tenant.stages.lost);
    assert.equal(await statusOf(property.id), "AVAILABLE");
  });

  it("frees the property when its Won opportunity is deleted", async () => {
    const property = await createProperty();
    const opp = await createOpp(property.id);
    await moveTo(opp.id, tenant.stages.won);
    assert.equal((await call(DELETE_OPP, "DELETE", { params: { id: opp.id } })).status, 200);
    assert.equal(await statusOf(property.id), "AVAILABLE");
  });

  it("moves the SOLD status when a Won opportunity is re-linked to another property", async () => {
    const a = await createProperty();
    const b = await createProperty();
    const opp = await createOpp(a.id);
    await moveTo(opp.id, tenant.stages.won);
    const res = await call(PATCH_OPP, "PATCH", { params: { id: opp.id }, body: { linkedPropertyId: b.id } });
    assert.equal(res.status, 200);
    assert.equal(await statusOf(a.id), "AVAILABLE");
    assert.equal(await statusOf(b.id), "SOLD");
  });

  it("an opportunity created directly in a Won stage claims its property; a second one is rejected", async () => {
    const property = await createProperty();
    const body = (name: string) => ({
      name,
      dealSide: "BUYER",
      value: 10,
      stageId: tenant.stages.won,
      linkedPropertyId: property.id,
    });
    assert.equal((await call(POST_OPP, "POST", { body: body("one") })).status, 201);
    assert.equal(await statusOf(property.id), "SOLD");
    assert.equal((await call(POST_OPP, "POST", { body: body("two") })).status, 409);
    assert.equal(await prisma.opportunity.count({ where: { linkedPropertyId: property.id } }), 1);
  });

  it("writes one PROPERTY_STATUS_CHANGED audit row per real change only", async () => {
    const property = await createProperty();
    const opp = await createOpp(property.id);
    await moveTo(opp.id, tenant.stages.won);
    await moveTo(opp.id, tenant.stages.won); // same stage: no-op
    const audits = () =>
      prisma.auditLog.count({
        where: { workspaceId: tenant.workspaceId, entity: "Property", entityId: property.id, action: "PROPERTY_STATUS_CHANGED" },
      });
    assert.equal(await audits(), 1);
    await moveTo(opp.id, tenant.stages.lost);
    assert.equal(await audits(), 2);
  });

  it("concurrent Won on two opportunities for one property: exactly one wins", async () => {
    for (let i = 0; i < 5; i++) {
      const property = await createProperty();
      const a = await createOpp(property.id);
      const b = await createOpp(property.id);
      const results = await Promise.all([moveTo(a.id, tenant.stages.won), moveTo(b.id, tenant.stages.won)]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
      assert.equal(await statusOf(property.id), "SOLD");
      assert.equal(
        await prisma.opportunity.count({ where: { linkedPropertyId: property.id, stage: { isWon: true } } }),
        1,
      );
    }
  });

  it("racing a Won against the other deal's Lost/reopen always ends consistent", async () => {
    for (let i = 0; i < 6; i++) {
      const property = await createProperty();
      const winner = await createOpp(property.id);
      const other = await createOpp(property.id);
      await moveTo(winner.id, tenant.stages.won);
      // Concurrently: winner reopens while the other deal tries to win.
      await Promise.all([moveTo(winner.id, i % 2 ? tenant.stages.lost : tenant.stages.open), moveTo(other.id, tenant.stages.won)]);
      const holders = await prisma.opportunity.count({
        where: { linkedPropertyId: property.id, deletedAt: null, stage: { isWon: true } },
      });
      assert.ok(holders <= 1, "never two Won holders");
      assert.equal(await statusOf(property.id), holders === 1 ? "SOLD" : "AVAILABLE");
    }
  });

  it("still converts the linked lead when the deal is won", async () => {
    const property = await createProperty();
    const lead = await prisma.lead.create({ data: { workspaceId: tenant.workspaceId, firstName: "L", lastName: "L" } });
    const opp = await createOpp(property.id, tenant.stages.open, lead.id);
    await moveTo(opp.id, tenant.stages.won);
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).stage, "CONVERTED");
  });
});
