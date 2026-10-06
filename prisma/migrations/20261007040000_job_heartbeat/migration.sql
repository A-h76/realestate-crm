-- One row per scheduled job (custody sweep, webhook recovery): when it last ran, so a missing Railway cron
-- service shows up as "stale" instead of silence. Upserted in place, so it never grows.
CREATE TABLE "JobHeartbeat" (
    "name" TEXT NOT NULL,
    "lastRanAt" TIMESTAMP(3) NOT NULL,
    "lastOkAt" TIMESTAMP(3),

    CONSTRAINT "JobHeartbeat_pkey" PRIMARY KEY ("name")
);
