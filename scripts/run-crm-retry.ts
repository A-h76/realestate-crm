/**
 * Retries enquiries that could not be copied to a client's HubSpot / Google Sheet (src/lib/crm/sync.ts). Invoked every
 * 5 minutes by a Railway Cron Job service (docs/ops/SCHEDULED-AUTOMATIONS.md). Safe to run overlapping or repeatedly:
 * each delivery is claimed with an optimistic attempt counter.
 *
 * Run: npm run crm:retry               retry what failed
 *      npm run crm:retry -- --requeue  also re-queue "gave up" ones, after you have fixed the connection
 */
import { prisma } from "../src/lib/db";
import { retryCrmSync } from "../src/lib/crm/sync";
import { recordHeartbeat } from "../src/lib/jobs/heartbeat";

async function main() {
  const result = await retryCrmSync({ includeGaveUp: process.argv.includes("--requeue") });
  await recordHeartbeat("crm-retry", result.gaveUp === 0);
  console.log(`[crm-retry] sent=${result.sent} failed=${result.failed} gaveUp=${result.gaveUp}`);
  if (result.gaveUp > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("[crm-retry] failed", error instanceof Error ? error.message.split("\n")[0] : "unknown_error");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
