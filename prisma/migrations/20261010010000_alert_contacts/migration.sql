-- Alert contacts: people told about new/waiting enquiries by email without a login (no team seat), and the per-alert delivery log.
CREATE TABLE "AlertContact" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channel" "MessagingChannel" NOT NULL DEFAULT 'EMAIL',
    "address" TEXT NOT NULL,
    "label" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AlertContact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AlertDelivery" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AlertDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AlertContact_workspaceId_channel_address_key" ON "AlertContact"("workspaceId", "channel", "address");
CREATE UNIQUE INDEX "AlertDelivery_contactId_dedupeKey_key" ON "AlertDelivery"("contactId", "dedupeKey");
CREATE INDEX "AlertDelivery_contactId_createdAt_idx" ON "AlertDelivery"("contactId", "createdAt");

ALTER TABLE "AlertContact" ADD CONSTRAINT "AlertContact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AlertDelivery" ADD CONSTRAINT "AlertDelivery_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "AlertContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
