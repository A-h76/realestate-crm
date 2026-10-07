import "server-only";
import { prisma } from "@/lib/db";
import { loadLeadSignals, localDayWindow, toAttentionLead } from "./loader";
import { loadSourceCoverage, type SourceCoverage } from "@/lib/sources/coverage";
import { WORKABLE_STAGES, detectFlags } from "./rules";

export const LEDGER_DAYS = 30;
/** Milestone 1 scope. Rendered verbatim above the ledger so it can never imply wider coverage than it has. */
export const LEDGER_SCOPE =
  "Measured: leads that reached this CRM through WhatsApp, CSV import or manual entry. Leads from any other source (portals, ads, phone calls) are not connected yet, so they are not counted here.";
const SLA_MS = 5 * 60_000;
const LIST_LIMIT = 25;
const LEAD_LIMIT = 2000;

export type LedgerLead = { id: string; name: string; at: Date; ownerName: string | null };
export type LedgerGroup = { count: number; sample: LedgerLead[] };
export type LeakLedger = {
  generatedAt: Date;
  windowDays: number;
  /** Demo workspaces hold seeded data, not real traffic; nothing is measured for them. */
  demoWorkspace: boolean;
  leads: number;
  /** Only leads with a recorded firstContactAt. Everyone else is in `unknown`, never given a computed time. */
  firstResponse: {
    measured: number;
    withinSla: number;
    medianMin: number | null;
    p90Min: number | null;
    /** Which clock started each measured time: the lead's own receivedAt (e.g. CSV column) or, absent that, createdAt. */
    clock: { receivedAt: number; createdAt: number };
  };
  unknown: LedgerGroup;
  unowned: LedgerGroup;
  unanswered: LedgerGroup;
  /** Breach counts exist only from the sweeper's first run; since = null means it never ran, so breaches are unmeasured. */
  sweeper: { since: Date | null; slaBreaches: number; escalations: number };
  /** The denominator: declared sources vs sources with a live feed. No declarations = coverage unknown. */
  coverage: SourceCoverage;
};

const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] : null);
const nameOf = (l: { firstName: string; lastName: string | null }) => `${l.firstName} ${l.lastName ?? ""}`.trim();

export async function loadLeakLedger(workspaceId: string, now: Date = new Date()): Promise<LeakLedger> {
  const empty = (): LedgerGroup => ({ count: 0, sample: [] });
  const base: LeakLedger = {
    generatedAt: now,
    windowDays: LEDGER_DAYS,
    demoWorkspace: false,
    leads: 0,
    firstResponse: { measured: 0, withinSla: 0, medianMin: null, p90Min: null, clock: { receivedAt: 0, createdAt: 0 } },
    unknown: empty(),
    unowned: empty(),
    unanswered: empty(),
    sweeper: { since: null, slaBreaches: 0, escalations: 0 },
    coverage: { declaredCount: 0, liveCount: 0, rows: [] },
  };
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { isDemo: true, timezone: true } });
  if (!workspace) return base;
  if (workspace.isDemo) return { ...base, demoWorkspace: true };

  const since = new Date(now.getTime() - LEDGER_DAYS * 86_400_000);
  const rows = await prisma.lead.findMany({
    where: { workspaceId, deletedAt: null, OR: [{ createdAt: { gte: since } }, { stage: { in: [...WORKABLE_STAGES] } }] },
    include: { owner: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
    take: LEAD_LIMIT,
  });
  const ids = rows.map((l) => l.id);

  // Simulated traffic: leads with any demo-provider WhatsApp message, or whose creation audit is tagged simulated.
  const [demoMessages, simulatedCreates] = await Promise.all([
    prisma.whatsAppMessage.groupBy({ by: ["leadId"], where: { workspaceId, leadId: { in: ids }, provider: "demo" } }),
    prisma.auditLog.findMany({
      where: { workspaceId, action: "LEAD_CREATED", entityId: { in: ids }, metadata: { path: ["simulated"], equals: true } },
      select: { entityId: true },
    }),
  ]);
  const simulated = new Set<string>([...demoMessages.map((m) => m.leadId!), ...simulatedCreates.map((a) => a.entityId)]);
  const real = rows.filter((l) => !simulated.has(l.id));

  const inWindow = real.filter((l) => l.createdAt >= since);
  // Response clock starts when the lead really arrived (receivedAt), else when it entered the CRM (createdAt).
  const clockStart = (l: (typeof real)[number]) => l.receivedAt ?? l.createdAt;
  const hasContact = (l: (typeof real)[number]) => l.firstContactAt !== null && l.firstContactAt >= clockStart(l);
  const measuredLeads = inWindow.filter(hasContact);
  const times = measuredLeads
    .map((l) => l.firstContactAt!.getTime() - clockStart(l).getTime())
    .sort((a, b) => a - b);
  const toMin = (ms: number | null) => (ms == null ? null : Math.round(ms / 6_000) / 10);

  const workable = real.filter((l) => (WORKABLE_STAGES as readonly string[]).includes(l.stage));
  const signals = await loadLeadSignals(workspaceId, workable.map((l) => l.id), now);
  const today = localDayWindow(now, workspace.timezone);
  const unowned: LedgerLead[] = [];
  const unanswered: LedgerLead[] = [];
  for (const l of workable) {
    const s = signals.get(l.id)!;
    const flags = detectFlags(toAttentionLead(l), s, now, today);
    if (flags.includes("UNASSIGNED")) unowned.push({ id: l.id, name: nameOf(l), at: l.createdAt, ownerName: null });
    if (flags.includes("RESPOND_NOW") && s.lastInbound) unanswered.push({ id: l.id, name: nameOf(l), at: s.lastInbound.at, ownerName: l.owner?.name ?? null });
  }
  const group = (items: LedgerLead[]): LedgerGroup => ({
    count: items.length,
    sample: [...items].sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, LIST_LIMIT),
  });

  const notSimulated = { notIn: [...simulated] };
  const [coverage, firstRun, slaBreaches, escalations] = await Promise.all([
    loadSourceCoverage(workspaceId),
    prisma.auditLog.findFirst({ where: { workspaceId, action: "CUSTODY_SWEEP_RUN" }, orderBy: { occurredAt: "asc" }, select: { occurredAt: true } }),
    prisma.auditLog.count({ where: { workspaceId, action: "CUSTODY_SLA_BREACH", occurredAt: { gte: since }, entityId: notSimulated } }),
    prisma.auditLog.count({ where: { workspaceId, action: "CUSTODY_ESCALATED", occurredAt: { gte: since }, entityId: notSimulated } }),
  ]);

  return {
    ...base,
    leads: inWindow.length,
    firstResponse: {
      measured: times.length,
      withinSla: times.filter((t) => t <= SLA_MS).length,
      medianMin: toMin(pct(times, 0.5)),
      p90Min: toMin(pct(times, 0.9)),
      clock: {
        receivedAt: measuredLeads.filter((l) => l.receivedAt).length,
        createdAt: measuredLeads.filter((l) => !l.receivedAt).length,
      },
    },
    unknown: group(inWindow.filter((l) => !hasContact(l)).map((l) => ({ id: l.id, name: nameOf(l), at: l.createdAt, ownerName: l.owner?.name ?? null }))),
    unowned: group(unowned),
    unanswered: group(unanswered),
    sweeper: { since: firstRun?.occurredAt ?? null, slaBreaches, escalations },
    coverage,
  };
}
