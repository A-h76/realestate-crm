-- CreateEnum is not needed; existing enums remain.

-- Demo workspaces stay demo; new workspaces fail closed.
ALTER TABLE "Workspace" ALTER COLUMN "isDemo" SET DEFAULT false;

CREATE TABLE IF NOT EXISTS "WhatsAppIntegration" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "displayPhone" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppIntegration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppIntegration_phoneNumberId_key" ON "WhatsAppIntegration"("phoneNumberId");
CREATE INDEX IF NOT EXISTS "WhatsAppIntegration_workspaceId_idx" ON "WhatsAppIntegration"("workspaceId");

CREATE TABLE IF NOT EXISTS "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WebhookEvent_provider_externalEventId_key" ON "WebhookEvent"("provider", "externalEventId");
CREATE INDEX IF NOT EXISTS "WebhookEvent_workspaceId_createdAt_idx" ON "WebhookEvent"("workspaceId", "createdAt");

CREATE TABLE IF NOT EXISTS "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key","windowStart")
);

-- Deduplicate WhatsApp external IDs before uniqueness (keep newest).
DELETE FROM "WhatsAppMessage" a
USING "WhatsAppMessage" b
WHERE a."externalId" IS NOT NULL
  AND a."workspaceId" = b."workspaceId"
  AND a."provider" = b."provider"
  AND a."externalId" = b."externalId"
  AND a."createdAt" < b."createdAt";

CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppMessage_workspaceId_provider_externalId_key"
  ON "WhatsAppMessage"("workspaceId", "provider", "externalId");
CREATE INDEX IF NOT EXISTS "WhatsAppMessage_externalId_idx" ON "WhatsAppMessage"("externalId");

ALTER TABLE "WhatsAppIntegration"
  ADD CONSTRAINT "WhatsAppIntegration_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WebhookEvent"
  ADD CONSTRAINT "WebhookEvent_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
