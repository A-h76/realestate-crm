-- MANAGER: sales/team manager role between ADMIN and AGENT (see src/lib/authz.ts).
ALTER TYPE "WorkspaceRole" ADD VALUE IF NOT EXISTS 'MANAGER' AFTER 'ADMIN';

-- Team management audit trail (PATCH/DELETE /api/workspace/members/:userId).
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'MEMBER_ROLE_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'MEMBER_REMOVED';
