import { prisma } from "@/lib/db";

/** Each job runs on a Railway cron every `everyMin`; it is "stale" after missing three runs. */
export const JOBS = {
  "custody-sweep": { label: "Custody sweep (SLA breaches, auto-assign)", everyMin: 5 },
  "webhook-recovery": { label: "WhatsApp webhook recovery", everyMin: 5 },
} as const;
export type JobName = keyof typeof JOBS;
const STALE_AFTER_RUNS = 3;

/** Called by the cron scripts when a run finishes. `ok` = no failures; a failing run still proves the cron is alive. */
export async function recordHeartbeat(name: JobName, ok: boolean, now = new Date()) {
  await prisma.jobHeartbeat.upsert({
    where: { name },
    create: { name, lastRanAt: now, lastOkAt: ok ? now : null },
    update: { lastRanAt: now, ...(ok ? { lastOkAt: now } : {}) },
  });
}

export type JobStatus = { name: JobName; label: string; everyMin: number; lastRanAt: Date | null; lastOkAt: Date | null; state: "never" | "ok" | "failing" | "stale" };

export async function loadJobStatus(now = new Date()): Promise<JobStatus[]> {
  const rows = await prisma.jobHeartbeat.findMany({ where: { name: { in: Object.keys(JOBS) } } });
  return (Object.keys(JOBS) as JobName[]).map((name) => {
    const row = rows.find((r) => r.name === name);
    const { label, everyMin } = JOBS[name];
    const lastRanAt = row?.lastRanAt ?? null;
    const lastOkAt = row?.lastOkAt ?? null;
    const stale = lastRanAt && now.getTime() - lastRanAt.getTime() > STALE_AFTER_RUNS * everyMin * 60_000;
    // "failing" = ran recently but the last good run is older than the last run.
    const state = !lastRanAt ? "never" : stale ? "stale" : lastOkAt && lastOkAt.getTime() === lastRanAt.getTime() ? "ok" : "failing";
    return { name, label, everyMin, lastRanAt, lastOkAt, state };
  });
}
