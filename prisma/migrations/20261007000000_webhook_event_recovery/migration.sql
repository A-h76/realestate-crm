-- Webhook recovery: a claimed WebhookEvent whose post-commit steps never finished (crash after the claim
-- committed) stays processedAt = NULL and is re-driven by the recovery sweep. Additive.
ALTER TABLE "WebhookEvent" ADD COLUMN "processedAt" TIMESTAMP(3);
ALTER TABLE "WebhookEvent" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
-- Everything claimed before this migration is treated as handled; otherwise the sweep would replay history.
UPDATE "WebhookEvent" SET "processedAt" = "createdAt";
CREATE INDEX "WebhookEvent_processedAt_createdAt_idx" ON "WebhookEvent"("processedAt", "createdAt");
