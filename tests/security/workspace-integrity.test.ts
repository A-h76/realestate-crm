import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/lib/db";
import { findCrossWorkspaceReferences, workspaceScopedRelations } from "../../src/lib/integrity/workspace-integrity";
import { createTenant, destroyTenant, type Tenant } from "../helpers/http";

/**
 * DATA-006: the database itself allows a row to reference another workspace's row (no composite FKs).
 * The checker finds such rows. Here one is planted directly in SQL, bypassing every app-level guard.
 */
describe("workspace integrity checker", () => {
  let a: Tenant;
  let b: Tenant;

  before(async () => {
    a = await createTenant("integ-a");
    b = await createTenant("integ-b");
  });

  after(async () => {
    await destroyTenant(a);
    await destroyTenant(b);
  });

  it("derives its relation list from the schema and covers the relations the app guards in code", () => {
    const pairs = new Set(workspaceScopedRelations().map((r) => `${r.child}.${r.column}->${r.parent}`));
    for (const expected of [
      "Opportunity.leadId->Lead",
      "Opportunity.linkedPropertyId->Property",
      "Opportunity.stageId->PipelineStage",
      "Task.leadId->Lead",
      "Proposal.opportunityId->Opportunity",
      "WhatsAppMessage.leadId->Lead",
    ]) {
      assert.ok(pairs.has(expected), `missing ${expected}`);
    }
    assert.ok(pairs.size >= 30, `expected broad coverage, got ${pairs.size}`);
  });

  it("reports nothing for workspaces whose data is consistent", async () => {
    const lead = await prisma.lead.create({ data: { workspaceId: a.workspaceId, firstName: "Own" } });
    await prisma.task.create({ data: { workspaceId: a.workspaceId, title: "t", leadId: lead.id } });
    assert.deepEqual((await findCrossWorkspaceReferences(a.workspaceId)).findings, []);
    assert.deepEqual((await findCrossWorkspaceReferences(b.workspaceId)).findings, []);
  });

  it("finds a row planted across workspaces (task in A pointing at a lead in B), scoped and global", async () => {
    const foreignLead = await prisma.lead.create({ data: { workspaceId: b.workspaceId, firstName: "Foreign" } });
    const id = `plant-${Date.now()}`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Task" (id, "workspaceId", title, "leadId", "updatedAt") VALUES ($1, $2, 'planted', $3, now())`,
      id,
      a.workspaceId,
      foreignLead.id,
    );
    for (const scope of [a.workspaceId, b.workspaceId, undefined]) {
      const { findings } = await findCrossWorkspaceReferences(scope);
      const hit = findings.find((f) => f.child === "Task" && f.column === "leadId" && f.parent === "Lead");
      assert.ok(hit && hit.count >= 1, `not found for scope ${scope ?? "global"}`);
    }
    // A third workspace is unaffected by the scoped run.
    const c = await createTenant("integ-c");
    try {
      assert.deepEqual((await findCrossWorkspaceReferences(c.workspaceId)).findings, []);
    } finally {
      await destroyTenant(c);
    }
    await prisma.task.delete({ where: { id } });
  });
});
