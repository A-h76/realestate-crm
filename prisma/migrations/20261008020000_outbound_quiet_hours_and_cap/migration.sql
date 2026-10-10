-- Outbound gate: quiet hours, per-recipient frequency cap, recipient timezone. Additive, defaulted columns only.
-- Quiet hours are minutes after local midnight; start > end means the window wraps midnight (21:00 -> 08:00).
ALTER TABLE "Workspace"
  ADD COLUMN "quietHoursStartMin" INTEGER NOT NULL DEFAULT 1260,
  ADD COLUMN "quietHoursEndMin" INTEGER NOT NULL DEFAULT 480,
  ADD COLUMN "autoMessageCap" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "autoMessageCapHours" INTEGER NOT NULL DEFAULT 24;
-- IANA zone for this recipient when known; null = fall back to the workspace timezone.
ALTER TABLE "MessagingConsent" ADD COLUMN "timezone" TEXT;
