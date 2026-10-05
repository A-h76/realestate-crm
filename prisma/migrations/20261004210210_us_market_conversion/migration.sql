-- CreateEnum
CREATE TYPE "AiMode" AS ENUM ('DRAFT', 'AUTO');

-- CreateEnum
CREATE TYPE "MessagingChannel" AS ENUM ('WHATSAPP', 'SMS', 'EMAIL');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('UNKNOWN', 'GRANTED', 'REVOKED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LeadSource" ADD VALUE 'ZILLOW';
ALTER TYPE "LeadSource" ADD VALUE 'REALTOR_COM';
ALTER TYPE "LeadSource" ADD VALUE 'HOMES_COM';
ALTER TYPE "LeadSource" ADD VALUE 'WEB_FORM';
ALTER TYPE "LeadSource" ADD VALUE 'OPEN_HOUSE';
ALTER TYPE "LeadSource" ADD VALUE 'SIGN_CALL';
ALTER TYPE "LeadSource" ADD VALUE 'AGENT_REFERRAL';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PropertyType" ADD VALUE 'SINGLE_FAMILY';
ALTER TYPE "PropertyType" ADD VALUE 'CONDO';
ALTER TYPE "PropertyType" ADD VALUE 'TOWNHOUSE';
ALTER TYPE "PropertyType" ADD VALUE 'MULTI_FAMILY';
ALTER TYPE "PropertyType" ADD VALUE 'LAND';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SizeUnit" ADD VALUE 'ACRE';
ALTER TYPE "SizeUnit" ADD VALUE 'SQM';

-- AlterTable
ALTER TABLE "Lead" ALTER COLUMN "currency" SET DEFAULT 'USD';

-- AlterTable
ALTER TABLE "Opportunity" ALTER COLUMN "currency" SET DEFAULT 'USD';

-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "country" TEXT NOT NULL DEFAULT 'US',
ADD COLUMN     "lotSizeAcres" DECIMAL(10,3),
ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "state" TEXT,
ALTER COLUMN "city" DROP DEFAULT,
ALTER COLUMN "sizeUnit" SET DEFAULT 'SQFT',
ALTER COLUMN "currency" SET DEFAULT 'USD';

-- AlterTable
ALTER TABLE "Proposal" ALTER COLUMN "currency" SET DEFAULT 'USD';

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "aiMode" "AiMode" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "region" TEXT NOT NULL DEFAULT 'US',
ALTER COLUMN "timezone" SET DEFAULT 'America/New_York',
ALTER COLUMN "currency" SET DEFAULT 'USD';

-- CreateTable
CREATE TABLE "MessagingConsent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channel" "MessagingChannel" NOT NULL,
    "address" TEXT NOT NULL,
    "status" "ConsentStatus" NOT NULL DEFAULT 'UNKNOWN',
    "source" TEXT NOT NULL,
    "evidence" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "leadId" TEXT,
    "contactId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessagingConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessagingConsent_workspaceId_status_idx" ON "MessagingConsent"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MessagingConsent_workspaceId_channel_address_key" ON "MessagingConsent"("workspaceId", "channel", "address");

-- CreateIndex
CREATE INDEX "Property_workspaceId_state_postalCode_idx" ON "Property"("workspaceId", "state", "postalCode");

-- AddForeignKey
ALTER TABLE "MessagingConsent" ADD CONSTRAINT "MessagingConsent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
