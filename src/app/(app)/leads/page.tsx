import Link from "next/link";
import { requireAppAccess } from "@/lib/app-access";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { loadLeadAttentionMap } from "@/lib/attention/loader";
import { LeadsTable, type LeadRow } from "./leads-table";

const FILTERS = {
  attention: "Needs attention",
  mine: "My leads",
  unassigned: "Without an owner",
  uncontacted: "New leads not contacted",
  "going-cold": "Going cold",
  "no-next-action": "No next action",
} as const;
type FilterKey = keyof typeof FILTERS;

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { workspaceId, userId, workspace } = await requireAppAccess();
  const { filter: filterParam } = await searchParams;
  const filter = filterParam && filterParam in FILTERS ? (filterParam as FilterKey) : null;

  let initialLeads: LeadRow[] | undefined;
  try {
    const leads = await prisma.lead.findMany({
      where: { workspaceId: workspaceId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: { owner: { select: { id: true, name: true } } },
    });
    const attention = await loadLeadAttentionMap(workspaceId, leads, workspace.timezone);
    const rows: LeadRow[] = leads.map((l) => {
      const info = attention.get(l.id);
      return {
        id: l.id,
        firstName: l.firstName,
        lastName: l.lastName,
        company: l.company,
        email: l.email,
        phone: l.phone,
        source: l.source,
        industry: l.industry,
        leadScore: l.leadScore,
        fitScore: l.fitScore,
        intentScore: l.intentScore,
        valueScore: l.valueScore,
        stage: l.stage,
        nextAction: info?.nextAction?.label ?? null,
        followUpDue: l.followUpDue?.toISOString() ?? null,
        lastActivityAt: l.lastActivityAt?.toISOString() ?? null,
        createdAt: l.createdAt.toISOString(),
        estimatedValue: l.estimatedValue?.toString() ?? null,
        owner: l.owner,
        state: info?.state,
        priorityLevel: info?.priority.level,
        why: info?.priority.reasons,
      };
    });
    initialLeads = filter
      ? rows.filter((row) => {
          const info = attention.get(row.id);
          const open = ["NEW", "CONTACTED", "QUALIFIED", "NURTURING"].includes(row.stage);
          switch (filter) {
            case "attention":
              return info?.state === "Needs Attention";
            case "mine":
              return row.owner?.id === userId;
            case "unassigned":
              return open && !row.owner;
            case "uncontacted":
              return Boolean(info?.flags.includes("NEW_UNCONTACTED"));
            case "going-cold":
              return Boolean(info?.flags.includes("GOING_COLD"));
            case "no-next-action":
              return ["NEW", "CONTACTED", "QUALIFIED"].includes(row.stage) && !row.nextAction;
          }
        })
      : rows;
  } catch {
    initialLeads = undefined;
  }

  return (
    <div className="space-y-6 p-4 md:p-8">
      <PageHeader
        eyebrow="Leads"
        title="Leads"
        description="Everyone who has reached out, who owns them, and what to do next."
      />
      <nav aria-label="Lead views" className="flex flex-wrap gap-2 text-[12px]">
        {[{ key: null, label: "All leads" }, ...(Object.entries(FILTERS) as [FilterKey, string][]).map(([key, label]) => ({ key, label }))].map(
          (f) => (
            <Link
              key={f.label}
              href={f.key ? `/leads?filter=${f.key}` : "/leads"}
              aria-current={filter === f.key ? "page" : undefined}
              className={`rounded-full border px-3 py-1 font-medium ${
                filter === f.key ? "border-brand bg-brand text-white" : "border-border bg-surface text-muted hover:text-foreground"
              }`}
            >
              {f.label}
            </Link>
          ),
        )}
      </nav>
      <LeadsTable
        key={filter ?? "all"}
        initialLeads={initialLeads}
        emptyMessage={
          filter
            ? "Nothing here. Everything in this view is handled."
            : "No leads yet. Import your leads or connect a lead source."
        }
      />
    </div>
  );
}
