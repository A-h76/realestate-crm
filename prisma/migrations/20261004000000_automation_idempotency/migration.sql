-- AUTO-003 / SEC-011: DB-enforced idempotency for automation side effects.
-- Additive and nullable; existing rows are untouched. Rollback SQL: docs/ops/ROLLBACK-RUNBOOK.md.
ALTER TABLE "Task" ADD COLUMN "dedupeKey" TEXT;
ALTER TABLE "Notification" ADD COLUMN "dedupeKey" TEXT;
CREATE UNIQUE INDEX "Task_workspaceId_dedupeKey_key" ON "Task"("workspaceId", "dedupeKey");
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");
