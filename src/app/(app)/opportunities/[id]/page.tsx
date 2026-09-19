import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ActivityTimeline } from "@/components/activity-timeline";
import { PageHeader, SectionHeading } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDatePK, formatDateTimePK } from "@/lib/format";

function daysBetween(from: Date, to = new Date()) {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86400000));
}

export default async function OpportunityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) return null;
  const { id } = await params;

  const opp = await prisma.opportunity.findFirst({
    where: { id, workspaceId: session.user.workspaceId, deletedAt: null },
    include: {
      stage: true,
      owner: true,
      account: true,
      primaryContact: true,
      lead: true,
      linkedProperty: true,
      activities: {
        orderBy: { date: "desc" },
        take: 25,
        include: { owner: { select: { name: true } } },
      },
      tasks: { where: { deletedAt: null }, orderBy: { dueAt: "asc" }, take: 15 },
      proposals: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
      calendarEvents: {
        where: { deletedAt: null },
        orderBy: { startAt: "asc" },
        take: 10,
      },
      noteEntries: {
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { author: { select: { name: true } } },
      },
    },
  });

  if (!opp) notFound();

  const prob = opp.probability || opp.stage.probability;
  const weighted = (Number(opp.value) * prob) / 100;

  return (
    <div className="space-y-8 p-8">
      <PageHeader
        eyebrow="Opportunity"
        title={opp.name}
        description={opp.description ?? undefined}
        actions={
          <>
            <Badge tone={opp.dealSide === "BUYER" ? "accent" : "warning"}>{opp.dealSide}</Badge>
            <Badge tone="neutral">{opp.stage.name}</Badge>
          </>
        }
      />

      <section>
        <SectionHeading>Deal metrics</SectionHeading>
        <div className="grid gap-px border border-border bg-border sm:grid-cols-4">
          {[
            ["Value", formatCurrency(Number(opp.value))],
            ["Weighted value", formatCurrency(weighted)],
            ["Probability", `${prob}%`],
            ["Days open", String(daysBetween(opp.createdAt))],
            ["Days in stage", String(daysBetween(opp.stageEnteredAt))],
            ["Expected close", formatDatePK(opp.expectedCloseDate)],
            ["Owner", opp.owner?.name ?? "—"],
            ["Source", opp.source?.replaceAll("_", " ") ?? "—"],
          ].map(([label, value]) => (
            <div key={label} className="bg-surface px-4 py-3">
              <div className="section-kicker">{label}</div>
              <div className="mt-1 text-sm font-medium">{value}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <SectionHeading>Links</SectionHeading>
        <div className="grid gap-px border border-border bg-border sm:grid-cols-2">
          <div className="bg-surface px-4 py-3">
            <div className="section-kicker">Lead</div>
            <div className="mt-1 text-sm">
              {opp.lead ? (
                <Link href={`/leads/${opp.lead.id}`} className="hover:text-accent">
                  {opp.lead.firstName} {opp.lead.lastName ?? ""}
                </Link>
              ) : (
                "—"
              )}
            </div>
          </div>
          <div className="bg-surface px-4 py-3">
            <div className="section-kicker">Property</div>
            <div className="mt-1 text-sm">
              {opp.linkedProperty ? (
                <Link href={`/properties/${opp.linkedProperty.id}`} className="hover:text-accent">
                  {opp.linkedProperty.title}
                </Link>
              ) : (
                "—"
              )}
            </div>
          </div>
          <div className="bg-surface px-4 py-3">
            <div className="section-kicker">Account</div>
            <div className="mt-1 text-sm">
              {opp.account ? (
                <Link href={`/accounts/${opp.account.id}`} className="hover:text-accent">
                  {opp.account.company}
                </Link>
              ) : (
                "—"
              )}
            </div>
          </div>
          <div className="bg-surface px-4 py-3">
            <div className="section-kicker">Primary contact</div>
            <div className="mt-1 text-sm">
              {opp.primaryContact ? (
                <Link href={`/contacts/${opp.primaryContact.id}`} className="hover:text-accent">
                  {opp.primaryContact.firstName} {opp.primaryContact.lastName ?? ""}
                </Link>
              ) : (
                "—"
              )}
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <SectionHeading>Proposals</SectionHeading>
          <div className="divide-y divide-border border border-border bg-surface">
            {opp.proposals.length === 0 ? (
              <div className="px-4 py-5 text-sm text-muted">No proposals.</div>
            ) : (
              opp.proposals.map((p) => (
                <div key={p.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{p.proposalNumber}</span>
                    <Badge tone="neutral">{p.status}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted">{formatCurrency(Number(p.value))}</div>
                </div>
              ))
            )}
          </div>
        </section>

        <section>
          <SectionHeading>Tasks</SectionHeading>
          <div className="divide-y divide-border border border-border bg-surface">
            {opp.tasks.length === 0 ? (
              <div className="px-4 py-5 text-sm text-muted">No tasks.</div>
            ) : (
              opp.tasks.map((t) => (
                <div key={t.id} className="px-4 py-3">
                  <div className="text-sm font-medium">{t.title}</div>
                  <div className="mono mt-1 text-[11px] text-muted">
                    {t.status} · {formatDatePK(t.dueAt)}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section>
          <SectionHeading>Calendar</SectionHeading>
          <div className="divide-y divide-border border border-border bg-surface">
            {opp.calendarEvents.length === 0 ? (
              <div className="px-4 py-5 text-sm text-muted">No events.</div>
            ) : (
              opp.calendarEvents.map((ev) => (
                <div key={ev.id} className="px-4 py-3">
                  <div className="text-sm font-medium">{ev.title}</div>
                  <div className="mono mt-1 text-[11px] text-muted">
                    {formatDateTimePK(ev.startAt)}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section>
          <SectionHeading>Notes</SectionHeading>
          <div className="divide-y divide-border border border-border bg-surface">
            {opp.notes ? (
              <div className="px-4 py-3 text-sm whitespace-pre-wrap">{opp.notes}</div>
            ) : null}
            {opp.noteEntries.length === 0 && !opp.notes ? (
              <div className="px-4 py-5 text-sm text-muted">No notes.</div>
            ) : (
              opp.noteEntries.map((n) => (
                <div key={n.id} className="px-4 py-3">
                  <p className="text-sm whitespace-pre-wrap">{n.body}</p>
                  <div className="mono mt-1 text-[11px] text-muted">
                    {formatDateTimePK(n.createdAt)}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <section>
        <SectionHeading>Activity</SectionHeading>
        <ActivityTimeline activities={opp.activities} />
      </section>
    </div>
  );
}
