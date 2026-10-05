/**
 * Re-drives inbound WhatsApp events whose post-commit steps never finished (see recoverStalledWebhookEvents).
 * Invoked on a cadence by a Railway Cron Job service (docs/ops/SCHEDULED-AUTOMATIONS.md), never from app code.
 * Safe to run overlapping or repeatedly: each replay step is idempotent and attempts are claimed optimistically.
 * Exits non-zero if any event failed to replay or has exhausted its attempts, so the cron run shows as failed.
 *
 * Run: npm run webhooks:recover
 */
import { prisma } from "../src/lib/db";
import { recoverStalledWebhookEvents } from "../src/lib/webhooks/whatsapp";

recoverStalledWebhookEvents()
  .then((r) => {
    console.log(`[webhook-recovery] done redriven=${r.redriven} failed=${r.failed} exhausted=${r.exhausted}`);
    if (r.failed > 0 || r.exhausted > 0) process.exitCode = 1;
  })
  .catch((error) => {
    console.error("[webhook-recovery] failed", error instanceof Error ? error.message.split("\n")[0] : "unknown_error");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
