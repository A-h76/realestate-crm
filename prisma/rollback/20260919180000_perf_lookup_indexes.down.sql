-- Reverses 20260919180000_perf_lookup_indexes (pure indexes: safe, only slower lookups).
DROP INDEX IF EXISTS "Lead_workspaceId_email_idx";
DROP INDEX IF EXISTS "Lead_workspaceId_phone_idx";
DROP INDEX IF EXISTS "Contact_workspaceId_phone_idx";
