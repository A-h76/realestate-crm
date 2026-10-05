-- Additive: generic US lead-source categories. These are labels, not integrations.
ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'GOOGLE_ADS';
ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'PHONE';
ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'MANUAL';
ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'OTHER';
