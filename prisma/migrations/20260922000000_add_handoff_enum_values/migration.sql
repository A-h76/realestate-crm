-- Adds enum values that were already applied to dev/prod via `prisma db push`
-- before migrations were adopted as the deployment path. Captured here so
-- `prisma migrate deploy` has a complete history to apply on fresh databases.

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'HANDOFF_TRIGGERED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'HUMAN_HANDOFF_REQUIRED';
