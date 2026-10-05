/**
 * AUTO-002: scheduled entry point for the inactive-lead follow-up automation.
 * Invoked on a cadence by a Railway Cron Job service (see docs/ops/SCHEDULED-AUTOMATIONS.md),
 * never from app code.
 *
 * Cadence: daily. The 14-day inactivity window makes anything faster pointless, and
 * evaluateInactiveLeads() skips leads it already actioned and holds a per-workspace advisory
 * lock, so a missed, doubled or overlapping run is harmless.
 *
 * A failure in one workspace is logged and does not stop the others; the process exits
 * non-zero if any workspace failed so the cron run shows as failed.
 *
 * Run: npm run automations:scheduled
 */
import { prisma } from "../src/lib/db";
import { evaluateInactiveLeads } from "../src/lib/automation/engine";

async function main() {
  const workspaces = await prisma.workspace.findMany({
    where: { deletedAt: null },
    select: { id: true, slug: true },
  });

  let total = 0;
  let failed = 0;
  for (const workspace of workspaces) {
    try {
      const state = { truncated: false };
      const results = await evaluateInactiveLeads(workspace.id, null, { deadlineMs: 4 * 60_000, state });
      if (state.truncated) console.log(`[scheduled-automations] workspace=${workspace.slug} time budget reached; rest deferred to next run`);
      total += results.length;
      console.log(`[scheduled-automations] workspace=${workspace.slug} actions=${results.length}`);
    } catch (error) {
      failed += 1;
      console.error(
        `[scheduled-automations] workspace=${workspace.slug} failed`,
        error instanceof Error ? error.message.split("\n")[0] : "unknown_error",
      );
    }
  }
  console.log(
    `[scheduled-automations] done workspaces=${workspaces.length} totalActions=${total} failedWorkspaces=${failed}`,
  );
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("[scheduled-automations] failed", error instanceof Error ? error.message.split("\n")[0] : "unknown_error");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
