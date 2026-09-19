import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ActivityTimeline } from "@/components/activity-timeline";
import { PageHeader, SectionHeading } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDatePK, formatDateTimePK } from "@/lib/format";

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) return null;
  const { id } = await params;

  const contact = await prisma.contact.findFirst({
    where: { id, workspaceId: session.user.workspaceId, deletedAt: null },
    include: {
      account: true,
      leads: { where: { deletedAt: null }, orderBy: { updatedAt: "desc" }, take: 15 },
      primaryOpportunities: {
        where: { deletedAt: null },
        include: { stage: true },
        orderBy: { updatedAt: "desc" },
        take: 15,
      },
      ownedProperties: {
        where: { deletedAt: null },
        orderBy: { updatedAt: "desc" },
        take: 10,
      },
      activities: {
        orderBy: { date: "desc" },
        take: 20,
        include: { owner: { select: { name: true } } },
      },
      tasks: { where: { deletedAt: null }, orderBy: { dueAt: "asc" }, take: 10 },
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

  if (!contact) notFound();

  const fullName = `${contact.firstName} ${contact.lastName ?? ""}`.trim();

  return (
    <div className="space-y-8 p-8">
      <PageHeader
        eyebrow="Contact"
        title={fullName}
        description={contact.title ?? undefined}
        actions={
          contact.account ? (
            <Link href={`/accounts/${contact.account.id}`}>
              <Badge tone="neutral">{contact.account.company}</Badge>
            </Link>
          ) : null
        }
      />

      <section>
        <SectionHeading>Details</SectionHeading>
        <div className="grid gap-px border border-border bg-border sm:grid-cols-3">
          {[
            ["Email", contact.email ?? "—"],
            ["Phone", contact.phone ?? "—"],
            ["WhatsApp", contact.whatsappNumber ?? "—"],
            ["Account", contact.account?.company ?? "—"],
            ["Created", formatDatePK(contact.createdAt)],
            ["Updated", formatDatePK(contact.updatedAt)],
          ].map(([label, value]) => (
            <div key={label} className="bg-surface px-4 py-3">
              <div className="section-kicker">{label}</div>
              <div className="mt-1 text-sm break-all">{value}</div>
            </div>
          ))}
        </div>
        {contact.notes ? (
          <p className="mt-3 border border-border bg-surface px-4 py-3 text-sm whitespace-pre-wrap">
            {contact.notes}
          </p>
        ) : null}
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <SectionHeading>Leads</SectionHeading>
          <div className="divide-y divide-border border border-border bg-surface">
            {contact.leads.length === 0 ? (
              <div className="px-4 py-5 text-sm text-muted">No linked leads.</div>
            ) : (
              contact.leads.map((l) => (
                <Link
                  key={l.id}
                  href={`/leads/${l.id}`}
                  className="flex items-center justify-between gap-2 px-4 py-3 hover:bg-background"
                >
                  <span className="text-sm font-medium">
                    {l.firstName} {l.lastName ?? ""}
                  </span>
                  <Badge tone="neutral">{l.stage}</Badge>
                </Link>
              ))
            )}
          </div>
        </section>

        <section>
          <SectionHeading>Opportunities</SectionHeading>
          <div className="divide-y divide-border border border-border bg-surface">
            {contact.primaryOpportunities.length === 0 ? (
              <div className="px-4 py-5 text-sm text-muted">No opportunities.</div>
            ) : (
              contact.primaryOpportunities.map((o) => (
                <Link
                  key={o.id}
                  href={`/opportunities/${o.id}`}
                  className="block px-4 py-3 hover:bg-background"
                >
                  <div className="text-sm font-medium">{o.name}</div>
                  <div className="mt-1 text-xs text-muted">
                    {o.stage.name} · {formatCurrency(Number(o.value))}
                  </div>
                </Link>
              ))
            )}
          </div>
        </section>

        <section>
          <SectionHeading>Owned properties</SectionHeading>
          <div className="divide-y divide-border border border-border bg-surface">
            {contact.ownedProperties.length === 0 ? (
              <div className="px-4 py-5 text-sm text-muted">No properties.</div>
            ) : (
              contact.ownedProperties.map((p) => (
                <Link
                  key={p.id}
                  href={`/properties/${p.id}`}
                  className="block px-4 py-3 hover:bg-background"
                >
                  <div className="text-sm font-medium">{p.title}</div>
                  <div className="mt-1 text-xs text-muted">
                    {p.propertyType} · {formatCurrency(Number(p.price), p.currency)}
                  </div>
                </Link>
              ))
            )}
          </div>
        </section>

        <section>
          <SectionHeading>Calendar</SectionHeading>
          <div className="divide-y divide-border border border-border bg-surface">
            {contact.calendarEvents.length === 0 ? (
              <div className="px-4 py-5 text-sm text-muted">No events.</div>
            ) : (
              contact.calendarEvents.map((ev) => (
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
      </div>

      <section>
        <SectionHeading>Activity</SectionHeading>
        <ActivityTimeline activities={contact.activities} />
      </section>
    </div>
  );
}
