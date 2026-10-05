-- Slice 3/4 of the Synas Standard: lead custody timestamps and richer audit events. All additive.
ALTER TYPE "AuditAction" ADD VALUE 'LEAD_FIRST_CONTACT';

CREATE TYPE "ActorType" AS ENUM ('USER', 'SYSTEM', 'AI', 'CUSTOMER', 'PROVIDER');

ALTER TABLE "Lead"
  ADD COLUMN "assignedAt" TIMESTAMP(3),
  ADD COLUMN "firstContactAt" TIMESTAMP(3);

CREATE INDEX "Lead_workspaceId_firstContactAt_createdAt_idx" ON "Lead"("workspaceId", "firstContactAt", "createdAt");

ALTER TABLE "AuditLog"
  ADD COLUMN "actorType" "ActorType" NOT NULL DEFAULT 'SYSTEM',
  ADD COLUMN "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "fromState" TEXT,
  ADD COLUMN "toState" TEXT,
  ADD COLUMN "providerEventId" TEXT;

-- Backfill what is knowable. Existing rows were recorded when they happened; a row with an actor is a user action.
UPDATE "AuditLog" SET "occurredAt" = "createdAt", "actorType" = CASE WHEN "actorId" IS NULL THEN 'SYSTEM'::"ActorType" ELSE 'USER'::"ActorType" END;
-- An owned lead was assigned no later than it was created; this is the only honest lower bound we have.
-- firstContactAt is deliberately NOT backfilled: null means "unknown", and metrics must not invent a response time.
UPDATE "Lead" SET "assignedAt" = "createdAt" WHERE "ownerId" IS NOT NULL;
