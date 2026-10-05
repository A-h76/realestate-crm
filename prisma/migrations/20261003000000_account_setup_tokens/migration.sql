-- CORE-002: invited members set their own password through a one-time, expiring link.
-- Additive only. Rollback: DROP TABLE "AccountSetupToken" (the enum value is harmless to leave).
CREATE TABLE "AccountSetupToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccountSetupToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountSetupToken_tokenHash_key" ON "AccountSetupToken"("tokenHash");
CREATE INDEX "AccountSetupToken_userId_idx" ON "AccountSetupToken"("userId");

ALTER TABLE "AccountSetupToken" ADD CONSTRAINT "AccountSetupToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'MEMBER_INVITE_ACCEPTED';
