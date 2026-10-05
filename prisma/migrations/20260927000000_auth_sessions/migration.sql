-- Server-side session records behind Auth.js JWTs (`sid` claim) so sessions can be
-- revoked on logout / member removal. Additive only: no existing data is touched.
-- Existing JWTs carry no `sid` and are rejected, forcing one re-login after deploy.
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");

ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Security audit events.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'USER_LOGOUT';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CSV_EXPORTED';
