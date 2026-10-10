-- Starter connectors: copy new enquiries into the client's own CRM (HubSpot, Google Sheets), with a per-event delivery log for retries.
CREATE TYPE "CrmKind" AS ENUM ('HUBSPOT', 'GOOGLE_SHEETS');

CREATE TABLE "CrmConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" "CrmKind" NOT NULL,
    "target" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CrmConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CrmSyncDelivery" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,
    "externalId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CrmSyncDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CrmConnection_workspaceId_kind_key" ON "CrmConnection"("workspaceId", "kind");
CREATE UNIQUE INDEX "CrmSyncDelivery_connectionId_dedupeKey_key" ON "CrmSyncDelivery"("connectionId", "dedupeKey");
CREATE INDEX "CrmSyncDelivery_status_updatedAt_idx" ON "CrmSyncDelivery"("status", "updatedAt");

ALTER TABLE "CrmConnection" ADD CONSTRAINT "CrmConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrmSyncDelivery" ADD CONSTRAINT "CrmSyncDelivery_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "CrmConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
