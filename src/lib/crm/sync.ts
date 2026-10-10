import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/log";
import { notifyOnce } from "@/lib/notifications";
import { hubspotConfigured, pushToHubspot } from "./hubspot";
import { pushToSheet, sheetsConfigured } from "./google-sheets";
import { CrmError, type SyncPayload } from "./types";

/**
 * Starter's promise: every enquiry is also saved in the CLIENT'S OWN CRM. A workspace has CrmConnection rows (HubSpot,
 * Google Sheets); each new lead, and each repeat enquiry, becomes one CrmSyncDelivery per connection. The unique
 * (connection, event) key makes a replay copy nothing twice. The first attempt runs right away, after the lead is
 * saved, and never throws: our own CRM is the system of record for the moment, a slow HubSpot must not lose a lead.
 * A failure is recorded and retried by `npm run crm:retry` (cron); after 5 attempts, or at once for a problem only a
 * person can fix (bad token), it is GAVE_UP and the workspace owners are told, once a day per connection.
 */
export const CRM_MAX_ATTEMPTS = 5;
const RETRY_MIN_AGE_MS = 2 * 60_000;

export const crmSyncAvailable = () => hubspotConfigured() || sheetsConfigured();

export async function syncNewLead(workspaceId: string, leadId: string) {
  await enqueue(workspaceId, leadId, `new:${leadId}`, { type: "new" });
}

export async function syncRepeatEnquiry(workspaceId: string, leadId: string, noteId: string, text: string) {
  await enqueue(workspaceId, leadId, `again:${noteId}`, { type: "again", text: text.slice(0, 2000) });
}

async function enqueue(workspaceId: string, leadId: string, dedupeKey: string, payload: SyncPayload) {
  if (!crmSyncAvailable()) return; // no credentials in this deployment: skip even the lookup
  try {
    const connections = await prisma.crmConnection.findMany({ where: { workspaceId, enabled: true }, select: { id: true } });
    for (const connection of connections) {
      let id: string;
      try {
        id = (await prisma.crmSyncDelivery.create({ data: { workspaceId, connectionId: connection.id, leadId, dedupeKey, payload }, select: { id: true } })).id;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue; // already queued
        throw e;
      }
      await attempt(id);
    }
  } catch (e) {
    logEvent("error", "crm_sync_enqueue_failed", { workspaceId, leadId, error: e });
  }
}

export type AttemptResult = "SENT" | "FAILED" | "GAVE_UP" | "skipped";

export async function attempt(deliveryId: string): Promise<AttemptResult> {
  const d = await prisma.crmSyncDelivery.findUnique({ where: { id: deliveryId }, include: { connection: true } });
  if (!d || d.status === "SENT") return "skipped";
  // Optimistic claim on the attempt counter: two overlapping runs cannot both send the same delivery.
  const claimed = await prisma.crmSyncDelivery.updateMany({ where: { id: d.id, attempts: d.attempts, status: { in: ["PENDING", "FAILED"] } }, data: { attempts: { increment: 1 } } });
  if (claimed.count === 0) return "skipped";

  const finish = (status: "SENT" | "FAILED" | "GAVE_UP", extra: { externalId?: string; error?: string }) =>
    prisma.crmSyncDelivery.update({ where: { id: d.id }, data: { status, externalId: extra.externalId ?? null, error: extra.error ?? null } });

  const lead = await prisma.lead.findFirst({
    where: { id: d.leadId, workspaceId: d.workspaceId },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true, company: true, source: true, notes: true, createdAt: true },
  });
  if (!lead || !d.connection.enabled) {
    await finish("GAVE_UP", { error: !lead ? "lead_missing" : "connection_disabled" });
    return "GAVE_UP";
  }
  try {
    const payload = d.payload as SyncPayload;
    const externalId = d.connection.kind === "HUBSPOT" ? await pushToHubspot(lead, payload) : await pushToSheet(d.connection.target, lead, payload);
    await finish("SENT", { externalId });
    return "SENT";
  } catch (e) {
    const err = e instanceof CrmError ? e : new CrmError("unexpected error", false);
    const giveUp = err.permanent || d.attempts + 1 >= CRM_MAX_ATTEMPTS;
    await finish(giveUp ? "GAVE_UP" : "FAILED", { error: err.message.slice(0, 200) });
    logEvent("warn", "crm_sync_failed", { workspaceId: d.workspaceId, kind: d.connection.kind, permanent: err.permanent, giveUp, error: err.message });
    if (giveUp) await tellOwners(d.workspaceId, d.connection.id, d.connection.kind, d.leadId, err.message);
    return giveUp ? "GAVE_UP" : "FAILED";
  }
}

async function tellOwners(workspaceId: string, connectionId: string, kind: string, leadId: string, reason: string) {
  try {
    const owners = await prisma.workspaceMember.findMany({ where: { workspaceId, role: { in: ["OWNER", "ADMIN"] } }, select: { userId: true } });
    const day = new Date().toISOString().slice(0, 10);
    for (const { userId } of owners) {
      await notifyOnce({
        workspaceId,
        userId,
        type: "AUTOMATION_FAILED",
        title: `An enquiry was not copied to ${kind === "HUBSPOT" ? "HubSpot" : "Google Sheets"}`,
        body: `${reason}. The enquiry is safe in this CRM. Ask Synas to fix the connection.`,
        href: `/leads/${leadId}`,
        entityType: "Lead",
        entityId: leadId,
        dedupeKey: `crm-gave-up:${connectionId}:${day}`, // once a day per connection, not once per lead
      });
    }
  } catch (e) {
    logEvent("error", "crm_sync_notify_failed", { workspaceId, error: e });
  }
}

/** Cron entry: retries deliveries that failed or never finished. `includeGaveUp` re-queues the ones that needed a fix (after you fixed it). */
export async function retryCrmSync(options: { includeGaveUp?: boolean; limit?: number } = {}) {
  const cutoff = new Date(Date.now() - RETRY_MIN_AGE_MS);
  if (options.includeGaveUp) {
    await prisma.crmSyncDelivery.updateMany({ where: { status: "GAVE_UP", error: { notIn: ["lead_missing"] } }, data: { status: "FAILED", attempts: 0, updatedAt: new Date(0) } });
  }
  const due = await prisma.crmSyncDelivery.findMany({
    where: { status: { in: ["PENDING", "FAILED"] }, updatedAt: { lt: cutoff } },
    orderBy: { createdAt: "asc" },
    take: options.limit ?? 100,
    select: { id: true },
  });
  const result = { sent: 0, failed: 0, gaveUp: 0 };
  for (const { id } of due) {
    const r = await attempt(id);
    if (r === "SENT") result.sent += 1;
    else if (r === "FAILED") result.failed += 1;
    else if (r === "GAVE_UP") result.gaveUp += 1;
  }
  return result;
}
