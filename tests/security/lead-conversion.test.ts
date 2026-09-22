import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/lib/db";
import { convertLeadOnOpportunityWon } from "../../src/lib/leads/convert-on-won";

/**
 * P0 #6 Golden Path: winning an Opportunity is the one event that should
 * authoritatively close out its source Lead too. LeadStage.CONVERTED already
 * existed (scoring, dashboard, insights, and the leads table stage filter
 * all already read it) but nothing ever wrote it — this is the missing
 * transition, not a new field.
 */
describe("convertLeadOnOpportunityWon", () => {
  let workspaceId: string;

  before(async () => {
    const workspace = await prisma.workspace.create({
      data: { name: "Lead Conversion Test", slug: `lead-conv-test-${randomUUID()}` },
    });
    workspaceId = workspace.id;
  });

  after(async () => {
    await prisma.workspace.delete({ where: { id: workspaceId } });
  });

  async function createLead(stage: "NEW" | "QUALIFIED" | "LOST" = "QUALIFIED") {
    return prisma.lead.create({
      data: { workspaceId, firstName: "Test", lastName: "Lead", stage },
    });
  }

  it("converts a qualified lead to CONVERTED and writes the audit trail", async () => {
    const lead = await createLead("QUALIFIED");
    const converted = await convertLeadOnOpportunityWon({
      workspaceId,
      actorId: null,
      leadId: lead.id,
      opportunityId: "opp_test_1",
    });
    assert.equal(converted, true);

    const updated = await prisma.lead.findUnique({ where: { id: lead.id } });
    assert.equal(updated!.stage, "CONVERTED");

    const audit = await prisma.auditLog.findFirst({
      where: { workspaceId, entity: "Lead", entityId: lead.id, action: "LEAD_STAGE_CHANGED" },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(audit);
    const metadata = audit!.metadata as Record<string, unknown>;
    assert.equal(metadata.from, "QUALIFIED");
    assert.equal(metadata.to, "CONVERTED");
    assert.equal(metadata.reason, "opportunity_won");
  });

  it("is idempotent — converting an already-CONVERTED lead is a no-op, no duplicate audit entry", async () => {
    const lead = await createLead("QUALIFIED");
    const first = await convertLeadOnOpportunityWon({ workspaceId, actorId: null, leadId: lead.id, opportunityId: "opp_test_2" });
    const second = await convertLeadOnOpportunityWon({ workspaceId, actorId: null, leadId: lead.id, opportunityId: "opp_test_2" });
    assert.equal(first, true);
    assert.equal(second, false);

    const audits = await prisma.auditLog.count({
      where: { workspaceId, entity: "Lead", entityId: lead.id, action: "LEAD_STAGE_CHANGED" },
    });
    assert.equal(audits, 1);
  });

  it("is authoritative — a won deal converts the lead even from a terminal LOST stage", async () => {
    const lead = await createLead("LOST");
    const converted = await convertLeadOnOpportunityWon({ workspaceId, actorId: null, leadId: lead.id, opportunityId: "opp_test_3" });
    assert.equal(converted, true);
    const updated = await prisma.lead.findUnique({ where: { id: lead.id } });
    assert.equal(updated!.stage, "CONVERTED");
  });
});
