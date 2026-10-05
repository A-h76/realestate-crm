-- CORE-002: new "invite a team member" endpoint writes this audit action.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'MEMBER_INVITED';
