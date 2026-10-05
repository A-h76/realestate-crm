-- Reverses 20261004000000_automation_idempotency. Discards every dedupeKey (automation idempotency is lost until re-applied).
DROP INDEX IF EXISTS "Task_workspaceId_dedupeKey_key";
DROP INDEX IF EXISTS "Notification_userId_dedupeKey_key";
ALTER TABLE "Task" DROP COLUMN IF EXISTS "dedupeKey";
ALTER TABLE "Notification" DROP COLUMN IF EXISTS "dedupeKey";
