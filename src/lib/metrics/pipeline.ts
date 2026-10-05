import { prisma } from "@/lib/db";

function toNumber(value: { toString(): string } | number | null | undefined): number {
  if (value == null) return 0;
  return typeof value === "number" ? value : Number(value.toString());
}

/**
 * CORE-001: the one place pipeline value, weighted pipeline, and won revenue
 * are computed — used by both the dashboard page and `/api/dashboard` so they
 * can never show different figures for the same workspace/time window again.
 */
export async function getPipelineMetrics(workspaceId: string, opts?: { wonSince?: Date }) {
  const stages = await prisma.pipelineStage.findMany({
    where: { workspaceId, active: true },
    select: { id: true, isWon: true, isLost: true },
  });
  const wonStageIds = stages.filter((s) => s.isWon).map((s) => s.id);
  const openStageIds = stages.filter((s) => !s.isWon && !s.isLost).map((s) => s.id);

  const [openOpps, wonOpps] = await Promise.all([
    prisma.opportunity.findMany({
      where: { workspaceId, deletedAt: null, stageId: { in: openStageIds } },
      select: { value: true, probability: true, stage: { select: { probability: true } } },
    }),
    prisma.opportunity.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        stageId: { in: wonStageIds },
        ...(opts?.wonSince ? { stageEnteredAt: { gte: opts.wonSince } } : {}),
      },
      select: { value: true },
    }),
  ]);

  const pipelineValue = openOpps.reduce((sum, o) => sum + toNumber(o.value), 0);
  const weightedPipeline = openOpps.reduce(
    (sum, o) => sum + (toNumber(o.value) * (o.probability || o.stage.probability)) / 100,
    0,
  );
  const wonRevenue = wonOpps.reduce((sum, o) => sum + toNumber(o.value), 0);

  return {
    openCount: openOpps.length,
    pipelineValue,
    weightedPipeline,
    wonRevenue,
    wonDealsCount: wonOpps.length,
  };
}
