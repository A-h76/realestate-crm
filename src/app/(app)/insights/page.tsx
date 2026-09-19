import Link from "next/link";
import { auth } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { workspaceInsights, resolveReportRange, pipelineAging } from "@/lib/insights";
import { formatCurrency } from "@/lib/format";
import { EditorialStat, RangeChips } from "@/components/editorial";

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const session = await auth();
  if (!session?.user) return null;
  const { range: preset = "30d" } = await searchParams;
  const range = resolveReportRange(preset);
  const [insights, aging] = await Promise.all([
    workspaceInsights(session.user.workspaceId, range),
    pipelineAging(session.user.workspaceId),
  ]);

  const stalled = aging.filter((r) => r.daysInStage >= 14);

  return (
    <div className="page-in space-y-12 p-6 md:p-10">
      <PageHeader
        eyebrow="Database-derived"
        title="Insights"
        description="Every figure is queried from CRM records. AI is not used for calculations."
      />

      <RangeChips
        value={preset}
        hrefFor={(id) => `/insights?range=${id}`}
        options={[
          { id: "today", label: "Today" },
          { id: "7d", label: "7 days" },
          { id: "30d", label: "30 days" },
          { id: "90d", label: "90 days" },
          { id: "all", label: "All" },
        ]}
      />

      <section className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
        <EditorialStat label="Leads" value={String(insights.totals.leads)} />
        <EditorialStat label="Win rate" value={`${Math.round(insights.conversionRates.opportunityWin * 100)}%`} />
        <EditorialStat label="Avg deal" value={formatCurrency(insights.averageDealSize)} />
        <EditorialStat label="Sales cycle" value={`${Math.round(insights.salesCycleDays)}d`} />
      </section>

      <div className="hairline" />

      <section>
        <div className="section-kicker">Lead sources</div>
        <div className="mt-4 divide-y divide-border">
          {Object.entries(insights.leadSources).map(([source, count]) => (
            <div key={source} className="flex justify-between py-2 text-sm">
              <span>{source.replaceAll("_", " ")}</span>
              <span className="mono">{count}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="section-kicker">Pipeline aging</div>
        <div className="mt-4 grid grid-cols-2 gap-6 md:grid-cols-5">
          {[
            ["0–7 days", insights.pipelineAging.d0_7],
            ["8–14", insights.pipelineAging.d8_14],
            ["15–30", insights.pipelineAging.d15_30],
            ["31–60", insights.pipelineAging.d31_60],
            ["60+", insights.pipelineAging.d60p],
          ].map(([label, value]) => (
            <div key={label}>
              <div className="section-kicker">{label}</div>
              <div className="mt-2 text-[22px] font-medium tracking-tight">{value}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="section-kicker">Stalled opportunities</div>
        <div className="mt-4 overflow-x-auto">
          <table className="ops w-full text-left text-sm">
            <thead>
              <tr className="meta">
                <th className="py-2 font-medium">Opportunity</th>
                <th className="py-2 font-medium">Stage</th>
                <th className="py-2 font-medium">Days</th>
                <th className="py-2 font-medium">Value</th>
                <th className="py-2 font-medium">Owner</th>
                <th className="py-2 font-medium">Next</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {stalled.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-muted">
                    No opportunities have sat in stage past 14 days.
                  </td>
                </tr>
              ) : (
                stalled.map((row) => (
                  <tr key={row.id} className="hover:bg-surface">
                    <td className="py-3">
                      <Link href={`/opportunities/${row.id}`}>{row.name}</Link>
                    </td>
                    <td className="py-3 text-muted">{row.stageName}</td>
                    <td className="mono py-3">{row.daysInStage}</td>
                    <td className="mono py-3">{formatCurrency(row.value)}</td>
                    <td className="py-3 text-muted">{row.ownerName ?? "—"}</td>
                    <td className="py-3 text-muted">{row.nextAction ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-10 md:grid-cols-2">
        <div>
          <div className="section-kicker">WhatsApp response</div>
          <div className="mt-2 text-3xl font-medium">{Math.round(insights.whatsappResponseRate * 100)}%</div>
          <p className="mt-2 text-sm text-muted">Threads with an inbound after the first outbound.</p>
        </div>
        <div>
          <div className="section-kicker">Follow-up</div>
          <div className="mt-2 text-3xl font-medium">{insights.followUp.overdue}</div>
          <p className="mt-2 text-sm text-muted">
            {insights.followUp.completed} completed · {insights.followUp.open} open
          </p>
        </div>
      </section>
    </div>
  );
}
