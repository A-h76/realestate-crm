import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ActivityTimeline } from "@/components/activity-timeline";
import { PageHeader, SectionHeading } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDatePK } from "@/lib/format";

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) return null;
  const { id } = await params;

  const account = await prisma.account.findFirst({
    where: { id, workspaceId: session.user.workspaceId, deletedAt: null },
    include: {
      owner: true,
      contacts: { where: { deletedAt: null }, orderBy: { firstName: "asc" } },
      leads: { where: { deletedAt: null }, orderBy: { updatedAt: "desc" }, take: 20 },
      opportunities: {
        where: { deletedAt: null },
        include: { stage: true },
        orderBy: { updatedAt: "desc" },
      },
      activities: {
        orderBy: { date: "desc" },
        take: 20,
        include: { owner: { select: { name: true } } },
      },
      tasks: { where: { deletedAt: null }, orderBy: { dueAt: "asc" }, take: 10 },
      noteEntries: {
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { author: { select: { name: true } } },
      },
    },
  });

  if (!account) notFound();

  return (
    <div className="space-y-8 p-8">
      <PageHeader
        eyebrow="Account"
        title={account.company}
        description={[account.industry, account.city].filter(Boolean).join(" · ") || undefined}
        actions={<Badge tone="neutral">{account.owner?.name ?? "Unassigned"}</Badge>}
      />

      <section>
        <SectionHeading>Profile</SectionHeading>
        <div className="grid gap-px border border-border bg-border sm:grid-cols-3">
          {[
            ["Website", account.website ?? "—"],
            ["Industry", account.industry ?? "—"],
            ["Company size", account.companySize ?? "—"],
            ["Location", [account.locationArea, account.city].filter(Boolean).join(", ") || "—"],
            ["Revenue range", account.revenueRange ?? "—"],
            ["Created", formatDatePK(account.createdAt)],
          ].map(([label, value]) => (
            <div key={label} className="bg-surface px-4 py-3">
              <div className="section-kicker">{label}</div>
              <div className="mt-1 text-sm break-all">{value}</div>
            </div>
          ))}
        </div>
        {account.notes ? (
          <p className="mt-3 border border-border bg-surface px-4 py-3 text-sm whitespace-pre-wrap">
            {account.notes}
          </p>
        ) : null}
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <SectionHeading>Contacts</SectionHeading>
          <div className="divide-y divide-border border border-border bg-surface">
            {account.contacts.length === 0 ? (
              <div className="px-4 py-5 text-sm text-muted">No contacts.</div>
            ) : (
              account.contacts.map((c) => (
                <Link
                  key={c.id}
                  href={`/contacts/${c.id}`}
                  className="block px-4 py-3 hover:bg-background"
                >
                  <div className="text-sm font-medium">
                    {c.firstName} {c.lastName ?? ""}
                  </div>
                  <div className="text-xs text-muted">
                    {[c.title, c.email, c.phone].filter(Boolean).join(" · ")}
                  </div>
                </Link>
              ))
            )}
          </div>
        </section>

        <section>
          <SectionHeading>Leads</SectionHeading>
          <div className="divide-y divide-border border border-border bg-surface">
            {account.leads.length === 0 ? (
              <div className="px-4 py-5 text-sm text-muted">No leads.</div>
            ) : (
              account.leads.map((l) => (
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
            {account.opportunities.length === 0 ? (
              <div className="px-4 py-5 text-sm text-muted">No opportunities.</div>
            ) : (
              account.opportunities.map((o) => (
                <Link
                  key={o.id}
                  href={`/opportunities/${o.id}`}
                  className="block px-4 py-3 hover:bg-background"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{o.name}</span>
                    <Badge tone="neutral">{o.dealSide}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    {o.stage.name} · {formatCurrency(Number(o.value))}
                  </div>
                </Link>
              ))
            )}
          </div>
        </section>

        <section>
          <SectionHeading>Tasks</SectionHeading>
          <div className="divide-y divide-border border border-border bg-surface">
            {account.tasks.length === 0 ? (
              <div className="px-4 py-5 text-sm text-muted">No tasks.</div>
            ) : (
              account.tasks.map((t) => (
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
      </div>

      <section>
        <SectionHeading>Activity</SectionHeading>
        <ActivityTimeline activities={account.activities} />
      </section>
    </div>
  );
}
