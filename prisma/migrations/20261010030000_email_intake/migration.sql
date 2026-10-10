-- Email as an intake source: an inbound mailbox maps to a workspace, and its enquiries get their own lead source.
ALTER TYPE "IntakeKind" ADD VALUE IF NOT EXISTS 'EMAIL';
ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'EMAIL';
