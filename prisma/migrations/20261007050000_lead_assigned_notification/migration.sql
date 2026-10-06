-- Tell the owner when the custody sweeper assigns them a lead. Additive enum value only.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'LEAD_ASSIGNED';
