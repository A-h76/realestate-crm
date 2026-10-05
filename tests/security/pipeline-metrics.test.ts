import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/lib/db";
import { getPipelineMetrics } from "../../src/lib/metrics/pipeline";

/**
 * CORE-001: the dashboard page and /api/dashboard must report identical
 * pipeline/won-revenue figures for the same workspace and time window —
 * they now share this one aggregation function instead of each computing
 * it independently (which had drifted: different won-revenue date filters,
 * different weighted-pipeline probability fallbacks).
 */
describe("getPipelineMetrics", () => {
  let workspaceId: string;
  let openStageId: string;
  let wonStageId: string;

  before(async () => {
    const workspace = await prisma.workspace.create({
      data: { name: "Pipeline Metrics Test", slug: `pipeline-metrics-test-${randomUUID()}` },
    });
    workspaceId = workspace.id;
    const open = await prisma.pipelineStage.create({
      data: { workspaceId, name: "Open", slug: "open", order: 1, probability: 40, active: true },
    });
    const won = await prisma.pipelineStage.create({
      data: { workspaceId, name: "Won", slug: "won", order: 2, probability: 100, active: true, isWon: true },
    });
    openStageId = open.id;
    wonStageId = won.id;
  });

  after(async () => {
    await prisma.workspace.delete({ where: { id: workspaceId } });
  });

  it("computes pipeline value and weighted pipeline from open opportunities, falling back to stage probability", async () => {
    await prisma.opportunity.create({
      data: { workspaceId, name: "Deal A", dealSide: "BUYER", value: 1_000_000, stageId: openStageId, probability: 0 },
    });
    const metrics = await getPipelineMetrics(workspaceId);
    assert.equal(metrics.pipelineValue, 1_000_000);
    // probability is 0 on the opportunity, so the stage's 40% fallback applies.
    assert.equal(metrics.weightedPipeline, 400_000);
    assert.equal(metrics.openCount, 1);
  });

  it("scopes won revenue to wonSince when given, matching the dashboard's month-to-date figure", async () => {
    const oldWon = new Date(Date.now() - 60 * 86400000);
    await prisma.opportunity.create({
      data: {
        workspaceId,
        name: "Old Won Deal",
        dealSide: "BUYER",
        value: 500_000,
        stageId: wonStageId,
        stageEnteredAt: oldWon,
      },
    });
    await prisma.opportunity.create({
      data: { workspaceId, name: "Recent Won Deal", dealSide: "BUYER", value: 250_000, stageId: wonStageId },
    });

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const scoped = await getPipelineMetrics(workspaceId, { wonSince: monthStart });
    assert.equal(scoped.wonRevenue, 250_000);
    assert.equal(scoped.wonDealsCount, 1);

    const allTime = await getPipelineMetrics(workspaceId);
    assert.equal(allTime.wonRevenue, 750_000);
    assert.equal(allTime.wonDealsCount, 2);
  });
});
