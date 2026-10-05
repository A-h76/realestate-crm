/**
 * Custody sweeper: assigns unowned leads and notifies / escalates when a lead waits past the first-response or
 * follow-up SLA (src/lib/custody/sweep.ts). Invoked every 5 minutes by a Railway Cron Job service
 * (docs/ops/SCHEDULED-AUTOMATIONS.md), never from app code.
 *
 * Safe to run overlapping or repeatedly: a per-workspace advisory lock and per-episode notification keys.
 * A failure in one workspace is logged and does not stop the others; exits non-zero if any workspace failed.
 *
 * Run: npm run custody:sweep   (uses --conditions=react-server: the attention loader imports "server-only")
 */
import { prisma } from "../src/lib/db";
import { sweepCustody } from "../src/lib/custody/sweep";

async function main() {
  const workspaces = await prisma.workspace.findMany({ where: { deletedAt: null }, select: { id: true, slug: true } });
  let failed = 0;
  for (const workspace of workspaces) {
    try {
      const r = await sweepCustody(workspace.id);
      console.log(
        r
          ? `[custody-sweep] workspace=${workspace.slug} checked=${r.leadsChecked} assigned=${r.assigned} breaches=${r.breaches} escalations=${r.escalations}`
          : `[custody-sweep] workspace=${workspace.slug} skipped (another run holds the lock)`,
      );
    } catch (error) {
      failed += 1;
      console.error(`[custody-sweep] workspace=${workspace.slug} failed`, error instanceof Error ? error.message.split("\n")[0] : "unknown_error");
    }
  }
  console.log(`[custody-sweep] done workspaces=${workspaces.length} failedWorkspaces=${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("[custody-sweep] failed", error instanceof Error ? error.message.split("\n")[0] : "unknown_error");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
