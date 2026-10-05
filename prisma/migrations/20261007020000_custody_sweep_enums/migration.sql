-- Custody sweeper: SYSTEM audit events for first-response / overdue breaches and their escalation,
-- plus a notification type for a breached first-response SLA. Additive enum values only.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CUSTODY_SLA_BREACH';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CUSTODY_ESCALATED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'RESPONSE_SLA_BREACH';
