import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/lib/db";
import { ApiError } from "../../src/lib/errors";
import { assertRelationsInWorkspace, assertResourceInWorkspace } from "../../src/lib/tenant";

/**
 * TEST-001: every route that accepts a client-supplied id for a related
 * record (leadId, accountId, linkedPropertyId, ownerId, ...) funnels through
 * assertResourceInWorkspace / assertRelationsInWorkspace in src/lib/tenant.ts.
 * This seeds two separate workspaces and proves workspace B's records are
 * never visible/usable from workspace A's session — this test fails the
 * moment a workspaceId filter is ever dropped from that shared guard.
 */
describe("Cross-tenant isolation (tenant.ts guards)", () => {
  let wsA: string;
  let wsB: string;
  // Records that live in workspace B only — every check below is performed
  // as if the actor is in workspace A.
  let leadB: string;
  let accountB: string;
  let contactB: string;
  let propertyB: string;
  let opportunityB: string;
  let taskB: string;
  let userB: string;
  let stageB: string;

  before(async () => {
    const [a, b] = await Promise.all([
      prisma.workspace.create({ data: { name: "Tenant A", slug: `tenant-a-${randomUUID()}` } }),
      prisma.workspace.create({ data: { name: "Tenant B", slug: `tenant-b-${randomUUID()}` } }),
    ]);
    wsA = a.id;
    wsB = b.id;

    const userBRow = await prisma.user.create({
      data: { email: `tenant-b-user-${randomUUID()}@example.com`, name: "B User", passwordHash: "x" },
    });
    userB = userBRow.id;
    await prisma.workspaceMember.create({ data: { workspaceId: wsB, userId: userB, role: "AGENT" } });

    const account = await prisma.account.create({ data: { workspaceId: wsB, company: "B Co" } });
    accountB = account.id;
    const contact = await prisma.contact.create({ data: { workspaceId: wsB, firstName: "B", lastName: "Contact" } });
    contactB = contact.id;
    const lead = await prisma.lead.create({ data: { workspaceId: wsB, firstName: "B", lastName: "Lead" } });
    leadB = lead.id;
    const property = await prisma.property.create({
      data: { workspaceId: wsB, title: "B Property", propertyType: "SINGLE_FAMILY", purpose: "SALE", price: 1, city: "Chicago" },
    });
    propertyB = property.id;
    const stage = await prisma.pipelineStage.create({
      data: { workspaceId: wsB, name: "B Stage", slug: "b-stage", order: 1 },
    });
    stageB = stage.id;
    const opportunity = await prisma.opportunity.create({
      data: { workspaceId: wsB, name: "B Deal", dealSide: "BUYER", value: 1, stageId: stageB },
    });
    opportunityB = opportunity.id;
    const task = await prisma.task.create({ data: { workspaceId: wsB, title: "B Task" } });
    taskB = task.id;
  });

  after(async () => {
    await prisma.workspace.delete({ where: { id: wsA } });
    await prisma.workspace.delete({ where: { id: wsB } });
    await prisma.user.delete({ where: { id: userB } });
  });

  async function assertNotFoundAcrossTenant(model: Parameters<typeof assertResourceInWorkspace>[0], id: string) {
    await assert.rejects(
      () => assertResourceInWorkspace(model, id, wsA),
      (error: unknown) => error instanceof ApiError && error.status === 404,
    );
    // Sanity check: the same id *is* visible from its own workspace.
    await assertResourceInWorkspace(model, id, wsB);
  }

  it("rejects a workspace-B lead when checked against workspace A", () => assertNotFoundAcrossTenant("lead", leadB));
  it("rejects a workspace-B account when checked against workspace A", () => assertNotFoundAcrossTenant("account", accountB));
  it("rejects a workspace-B contact when checked against workspace A", () => assertNotFoundAcrossTenant("contact", contactB));
  it("rejects a workspace-B property when checked against workspace A", () => assertNotFoundAcrossTenant("property", propertyB));
  it("rejects a workspace-B opportunity when checked against workspace A", () =>
    assertNotFoundAcrossTenant("opportunity", opportunityB));
  it("rejects a workspace-B task when checked against workspace A", () => assertNotFoundAcrossTenant("task", taskB));
  it("rejects a workspace-B pipeline stage when checked against workspace A", () =>
    assertNotFoundAcrossTenant("pipelineStage", stageB));

  it("rejects every cross-tenant foreign key in one relation bundle (opportunity create/patch shape)", async () => {
    await assert.rejects(
      () =>
        assertRelationsInWorkspace(wsA, {
          accountId: accountB,
          primaryContactId: contactB,
          leadId: leadB,
          linkedPropertyId: propertyB,
          stageId: stageB,
        }),
      (error: unknown) => error instanceof ApiError && error.status === 400,
    );
  });

  it("rejects a cross-tenant ownerId/assignedAgentId (membership check)", async () => {
    await assert.rejects(
      () => assertRelationsInWorkspace(wsA, { ownerId: userB }),
      (error: unknown) => error instanceof ApiError && error.status === 400,
    );
    await assert.rejects(
      () => assertRelationsInWorkspace(wsA, { assignedAgentId: userB }),
      (error: unknown) => error instanceof ApiError && error.status === 400,
    );
  });

  it("accepts the identical relation bundle when scoped to the owning workspace", async () => {
    await assertRelationsInWorkspace(wsB, {
      accountId: accountB,
      primaryContactId: contactB,
      leadId: leadB,
      linkedPropertyId: propertyB,
      stageId: stageB,
      ownerId: userB,
    });
  });
});
