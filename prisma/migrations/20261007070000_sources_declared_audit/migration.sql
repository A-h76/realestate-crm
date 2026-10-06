-- Audit row for changes to a workspace's declared lead sources. Additive enum value only.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SOURCES_DECLARED';
