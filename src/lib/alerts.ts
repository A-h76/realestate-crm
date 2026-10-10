import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/log";
import { sourceLabel } from "@/lib/dashboard-ui";
import { emailConfigured, sendEmail } from "@/lib/mail";

/**
 * Email alerts to people with no login (Workspace "alert contacts"), so a Starter shop can tell its whole team about a new
 * or waiting enquiry without anyone taking a team seat. Sent through Resend; the key and sender are per-deployment env
 * (RESEND_API_KEY, ALERT_FROM_EMAIL), so the client pays Resend directly. With either unset this is a silent no-op.
 *
 * Alerts carry the name, source and a one-line summary only. Phone numbers and history stay behind the login link.
 * Nothing here ever throws: a failed alert is recorded on AlertDelivery and logged, never allowed to break lead intake.
 */
/** Spam guard: a flooded public form must not become a flood of emails. Extra alerts in the hour are recorded THROTTLED. */
export const ALERT_HOURLY_CAP = 30;

export { emailConfigured as emailAlertsConfigured };

export type AlertInput = {
  workspaceId: string;
  /** Same key = same alert: a replayed event or re-run sweep sends nothing the second time. */
  dedupeKey: string;
  subject: string;
  lines: string[];
  /** In-app path (e.g. /leads/abc); appended as a full link when AUTH_URL is set. */
  href?: string;
};

export async function alertContacts(input: AlertInput): Promise<{ sent: number }> {
  let sent = 0;
  try {
    if (!emailConfigured()) return { sent };
    const contacts = await prisma.alertContact.findMany({
      where: { workspaceId: input.workspaceId, active: true, channel: "EMAIL" },
      select: { id: true, address: true },
    });
    const base = (process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "");
    const text = [...input.lines, ...(input.href && base ? ["", `Open in your CRM: ${base}${input.href}`] : []), "", "You get this because your team asked to be alerted. Ask Synas to change who receives it."].join("\n");
    const since = new Date(Date.now() - 60 * 60_000);

    for (const contact of contacts) {
      try {
        await prisma.alertDelivery.create({ data: { workspaceId: input.workspaceId, contactId: contact.id, dedupeKey: input.dedupeKey } });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue; // already handled
        throw e;
      }
      const recent = await prisma.alertDelivery.count({ where: { contactId: contact.id, createdAt: { gte: since }, status: { in: ["SENT", "PENDING"] } } });
      const where = { contactId_dedupeKey: { contactId: contact.id, dedupeKey: input.dedupeKey } };
      if (recent > ALERT_HOURLY_CAP) {
        await prisma.alertDelivery.update({ where, data: { status: "THROTTLED" } });
        continue;
      }
      const result = await sendEmail({ to: contact.address, subject: input.subject, text, idempotencyKey: `${contact.id}:${input.dedupeKey}` });
      await prisma.alertDelivery.update({ where, data: { status: result.ok ? "SENT" : "FAILED", error: result.ok ? null : result.error } });
      if (result.ok) sent += 1;
      else logEvent("warn", "alert_email_failed", { workspaceId: input.workspaceId, error: result.error });
    }
  } catch (e) {
    logEvent("error", "alert_failed", { workspaceId: input.workspaceId, error: e });
  }
  return { sent };
}

/** New enquiry: called once per lead from the shared lead-created path (web, WhatsApp, manual). Not CSV imports. */
export async function alertNewLead(workspaceId: string, leadId: string) {
  if (!emailConfigured()) return; // skip the lead lookup entirely when nothing could be sent
  try {
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, workspaceId },
      select: { firstName: true, lastName: true, company: true, source: true, notes: true },
    });
    if (!lead) return;
    const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Someone";
    const summary = lead.notes?.replace(/\s+/g, " ").trim().slice(0, 140);
    await alertContacts({
      workspaceId,
      dedupeKey: `lead-created:${leadId}`,
      subject: `New enquiry: ${name} (${sourceLabel(lead.source)})`,
      lines: [`${name}${lead.company ? ` from ${lead.company}` : ""} just got in touch via ${sourceLabel(lead.source)}.`, ...(summary ? [`"${summary}"`] : []), "", "Reply quickly: the first reply wins the customer."],
      href: `/leads/${leadId}`,
    });
  } catch (e) {
    logEvent("error", "alert_new_lead_failed", { workspaceId, leadId, error: e });
  }
}
