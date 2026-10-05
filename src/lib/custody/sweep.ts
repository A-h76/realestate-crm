import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { assignLeastLoadedAgent } from "@/lib/assignment/assign-lead";
import { loadLeadSignals, localDayWindow, toAttentionLead } from "@/lib/attention/loader";
import { WORKABLE_STAGES, detectFlags, elapsedLabel, followUpDate } from "@/lib/attention/rules";
import { notifyOnce } from "@/lib/notifications";

/**
 * Minutes a lead may wait before the owner is told, and before managers are told as well.
 * ponytail: constants, not a per-workspace setting; make them Workspace columns when a customer needs different SLAs.
 */
export const CUSTODY_SLA = {
  respondOwnerMin: 5,
  respondEscalateMin: 15,
  /** OVERDUE_FOLLOW_UP only fires once the due date is before today, so the owner hears at once. */
  overdueOwnerMin: 0,
  overdueEscalateMin: 24 * 60,
};

const LEAD_LIMIT = 500;
const BREACH_FLAGS = ["RESPOND_NOW", "NEW_UNCONTACTED", "OVERDUE_FOLLOW_UP"] as const;

export type CustodySweepResult = { leadsChecked: number; assigned: number; breaches: number; escalations: number };

/**
 * Per-workspace custody sweep. Holds a Postgres advisory lock so overlapping runs (second instance, doubled cron) do
 * nothing for that workspace; returns null when the lock was held elsewhere. Every notification is idempotent per
 * waiting episode (lead + flag + the timestamp the wait started from) via notifyOnce, so a re-run never re-notifies.
 */
export async function sweepCustody(workspaceId: string, options: { now?: Date } = {}): Promise<CustodySweepResult | null> {
  return prisma.$transaction(
    async (tx) => {
      const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtext(${`custody-sweep:${workspaceId}`})) AS locked`;
      if (!locked) return null;
      // The transaction only holds the lock; the work uses the shared client.
      return sweepLocked(workspaceId, options.now ?? new Date());
    },
    { timeout: 4 * 60_000, maxWait: 5_000 },
  );
}

async function sweepLocked(workspaceId: string, now: Date): Promise<CustodySweepResult> {
  const result: CustodySweepResult = { leadsChecked: 0, assigned: 0, breaches: 0, escalations: 0 };
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { timezone: true } });
  if (!workspace) return result;

  const leads = await prisma.lead.findMany({
    where: { workspaceId, deletedAt: null, stage: { in: [...WORKABLE_STAGES] } },
    include: { owner: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
    take: LEAD_LIMIT,
  });
  result.leadsChecked = leads.length;
  const signals = await loadLeadSignals(workspaceId, leads.map((l) => l.id), now);
  const today = localDayWindow(now, workspace.timezone);

  let managers: string[] | null = null;
  const managerIds = async () => {
    if (managers) return managers;
    const pick = async (roles: Array<"MANAGER" | "ADMIN" | "OWNER">) =>
      (await prisma.workspaceMember.findMany({ where: { workspaceId, role: { in: roles } }, select: { userId: true } })).map((m) => m.userId);
    managers = await pick(["MANAGER", "ADMIN"]);
    if (managers.length === 0) managers = await pick(["OWNER"]);
    return managers;
  };

  for (const lead of leads) {
    const attentionLead = toAttentionLead(lead);
    const s = signals.get(lead.id)!;
    const flags = detectFlags(attentionLead, s, now, today);
    let ownerId = lead.ownerId;

    if (flags.includes("UNASSIGNED")) {
      const assignment = await assignLeastLoadedAgent(workspaceId);
      if (assignment) {
        const claimed = await prisma.lead.updateMany({
          where: { id: lead.id, workspaceId, ownerId: null },
          data: { ownerId: assignment.agentId, assignedAt: now },
        });
        if (claimed.count === 1) {
          ownerId = assignment.agentId;
          result.assigned += 1;
          await writeAudit({
            workspaceId,
            action: "LEAD_UPDATED",
            entity: "Lead",
            entityId: lead.id,
            fromState: null,
            toState: assignment.agentId,
            metadata: { fields: ["ownerId"], assignmentStrategy: "least_loaded", reason: "custody_sweep_auto_assign" },
          });
        }
      }
    }

    for (const flag of BREACH_FLAGS) {
      if (!flags.includes(flag)) continue;
      const since =
        flag === "RESPOND_NOW" ? s.lastInbound?.at : flag === "NEW_UNCONTACTED" ? lead.createdAt : followUpDate(attentionLead, s);
      if (!since) continue;
      const overdue = flag === "OVERDUE_FOLLOW_UP";
      const ownerAfter = overdue ? CUSTODY_SLA.overdueOwnerMin : CUSTODY_SLA.respondOwnerMin;
      const escalateAfter = overdue ? CUSTODY_SLA.overdueEscalateMin : CUSTODY_SLA.respondEscalateMin;
      const waitedMin = (now.getTime() - since.getTime()) / 60_000;
      if (waitedMin < ownerAfter) continue;

      const name = attentionLead.name || "A lead";
      const waited = elapsedLabel(since, now);
      const message = overdue
        ? { type: "FOLLOW_UP_OVERDUE" as const, title: "Follow-up overdue", body: `${name}: follow-up was due ${waited} ago.` }
        : {
            type: "RESPONSE_SLA_BREACH" as const,
            title: flag === "RESPOND_NOW" ? "Customer waiting for a reply" : "New lead not contacted yet",
            body: `${name} has been waiting ${waited}.`,
          };
      const episode = `custody:${flag}:${lead.id}:${since.getTime()}`;
      const common = { workspaceId, ...message, href: `/leads/${lead.id}`, entityType: "Lead", entityId: lead.id };
      const metadata = { flag, sinceAt: since.toISOString(), waitedMinutes: Math.floor(waitedMin) };

      if (ownerId && (await notifyOnce({ ...common, userId: ownerId, dedupeKey: `${episode}:owner` }))) {
        result.breaches += 1;
        await writeAudit({
          workspaceId,
          action: "CUSTODY_SLA_BREACH",
          entity: "Lead",
          entityId: lead.id,
          occurredAt: now,
          toState: ownerId,
          metadata: { ...metadata, thresholdMinutes: ownerAfter },
        });
      }

      if (waitedMin >= escalateAfter || (!ownerId && waitedMin >= ownerAfter)) {
        let first = false;
        for (const userId of await managerIds()) {
          if (userId === ownerId) continue;
          if (await notifyOnce({ ...common, userId, title: `Escalated: ${message.title}`, dedupeKey: `${episode}:esc:${userId}` })) first = true;
        }
        if (first) {
          result.escalations += 1;
          await writeAudit({
            workspaceId,
            action: "CUSTODY_ESCALATED",
            entity: "Lead",
            entityId: lead.id,
            occurredAt: now,
            metadata: { ...metadata, thresholdMinutes: escalateAfter, ownerless: !ownerId },
          });
        }
      }
    }
  }
  return result;
}
