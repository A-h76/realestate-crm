DROP INDEX "WebhookEvent_processedAt_createdAt_idx";
ALTER TABLE "WebhookEvent" DROP COLUMN "attempts";
ALTER TABLE "WebhookEvent" DROP COLUMN "processedAt";
