-- Intake sources (website form keys, Meta lead-ads pages) and a notification type for a repeat enquiry from a known lead.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ENQUIRY_RECEIVED';

CREATE TYPE "IntakeKind" AS ENUM ('WEB_FORM', 'META_LEADS');

CREATE TABLE "IntakeSource" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" "IntakeKind" NOT NULL,
    "name" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "allowedOrigins" TEXT[],
    "externalId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IntakeSource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IntakeSource_publicKey_key" ON "IntakeSource"("publicKey");
CREATE UNIQUE INDEX "IntakeSource_kind_externalId_key" ON "IntakeSource"("kind", "externalId");
CREATE INDEX "IntakeSource_workspaceId_idx" ON "IntakeSource"("workspaceId");

ALTER TABLE "IntakeSource" ADD CONSTRAINT "IntakeSource_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
