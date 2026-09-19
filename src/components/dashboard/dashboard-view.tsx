import type { ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  FileText,
  MessageCircle,
  Trophy,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { LeadsSourceDonut, PipelineTrendChart, type SourceSlice, type TrendPoint } from "@/components/dashboard/charts";
import { formatCompactPKR, formatCurrency } from "@/lib/format";
import { initials } from "@/lib/dashboard-ui";
import { SourceName } from "@/components/source-name";
import { cn } from "@/lib/utils";

export type DashboardAction = {
  tone: "danger" | "warning" | "brand" | "accent";
  title: string;
  detail: string;
  ago: string;
  href: string;
};

export type DashboardLeadRow = {
  id: string;
  name: string;
  source: string;
  requirement: string;
  score: number;
  stage: string;
  owner: string;
  date: string;
};

export type DashboardOppRow = {
  id: string;
  name: string;
  value: number;
  stage: string;
  days: number;
  won?: boolean;
};

export type DashboardProperty = {
  id: string;
  title: string;
  area: string;
  price: number;
  status: string;
  beds: number | null;
  baths: number | null;
  size: string;
  cover: string;
};

export type DashboardVisit = {
  id: string;
  day: string;
  month: string;
  title: string;
  person: string;
  time: string;
};

export type DashboardViewProps = {
  greeting: string;
  dateLabel: string;
  firstName: string;
  temperatureSlot?: ReactNode;
  pipelineValue: number;
  weighted: number;
  pipelineDelta: number | null;
  weightedDelta: number | null;
  openCount: number;
  newThisWeek: number;
  visitsThisWeek: number;
  visitsTomorrow: number;
  proposalsCount: number;
  proposalsViewed: number;
  wonThisMonth: number;
  wonDealsThisMonth: number;
  trend: TrendPoint[];
  sources: SourceSlice[];
  leadTotal: number;
  actions: DashboardAction[];
  recentLeads: DashboardLeadRow[];
  recentOpps: DashboardOppRow[];
  properties: DashboardProperty[];
  visits: DashboardVisit[];
  demoMode?: boolean;
};

function Delta({ value }: { value: number | null }) {
  if (value == null) return <span className="text-[12px] text-white/80">No prior month</span>;
  const up = value >= 0;
  return (
    <span className="text-[12px] text-white/90">
      {up ? "+" : ""}
      {value.toFixed(1)}% vs last month
    </span>
  );
}

function scoreTone(score: number) {
  if (score >= 85) return "bg-emerald-50 text-success";
  if (score >= 70) return "bg-amber-50 text-warning";
  return "bg-slate-100 text-muted";
}

function stageTone(stage: string, won?: boolean) {
  const s = stage.toLowerCase();
  if (won || s === "won") return "bg-emerald-50 text-success";
  if (s.includes("negotiat")) return "bg-violet-50 text-brand";
  if (s.includes("proposal")) return "bg-sky-50 text-info";
  if (s.includes("qualif")) return "bg-emerald-50 text-success";
  if (s.includes("discover") || s.includes("site")) return "bg-amber-50 text-warning";
  if (s.includes("new")) return "bg-slate-100 text-muted";
  return "bg-slate-100 text-slate-700";
}

function ActionIcon({ tone }: { tone: DashboardAction["tone"] }) {
  const wrap = {
    danger: "bg-red-50 text-danger",
    warning: "bg-amber-50 text-warning",
    brand: "bg-violet-50 text-brand",
    accent: "bg-teal-50 text-teal-700",
  } as const;
  let Icon: typeof AlertTriangle;
  switch (tone) {
    case "danger":
      Icon = AlertTriangle;
      break;
    case "warning":
      Icon = CalendarDays;
      break;
    case "brand":
      Icon = FileText;
      break;
    case "accent":
      Icon = MessageCircle;
      break;
    default: {
      const _exhaustive: never = tone;
      throw new Error(`Unhandled action tone: ${String(_exhaustive)}`);
    }
  }
  return (
    <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", wrap[tone])}>
      <Icon className="h-4 w-4" />
    </span>
  );
}

export function DashboardView(props: DashboardViewProps) {
  return (
    <div className="page-in space-y-5 p-4 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="section-kicker">Sales operations</div>
          <h1 className="title mt-1">Turn more leads into address.</h1>
          <p className="mt-2 max-w-2xl text-[14px] text-muted">
            Track leads, match properties, manage site visits and close deals — all in one place.
          </p>
        </div>
        <div className="text-right">
          <div className="flex items-center justify-end gap-2">
            <div className="text-[12px] text-muted">{props.dateLabel}</div>
            {props.demoMode ? (
              <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-800">
                Demo Mode
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-[13px] font-medium">
            {props.greeting}, {props.firstName}.
          </div>
          <div className="mt-1 text-[12px] text-muted">
            Lahore, Pakistan
            {props.temperatureSlot}
          </div>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-6">
        <div className="rounded-[12px] bg-brand p-4 text-white shadow-[var(--shadow)]">
          <div className="flex items-start justify-between">
            <div className="text-[12px] font-medium text-white/80">Pipeline Value</div>
            <BarChart3 className="h-4 w-4 text-white/70" />
          </div>
          <div className="money mt-3 text-[20px] font-bold leading-tight">{formatCompactPKR(props.pipelineValue)}</div>
          <div className="mt-2">
            <Delta value={props.pipelineDelta} />
          </div>
        </div>
        <div className="rounded-[12px] bg-accent p-4 text-[#042f2e] shadow-[var(--shadow)]">
          <div className="text-[12px] font-medium text-[#042f2e]/70">Weighted Pipeline</div>
          <div className="money mt-3 text-[20px] font-bold leading-tight">{formatCompactPKR(props.weighted)}</div>
          <div className="mt-2 text-[12px]">
            {props.weightedDelta == null ? "No prior month" : `${props.weightedDelta >= 0 ? "+" : ""}${props.weightedDelta.toFixed(1)}% vs last month`}
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-start justify-between text-[12px] text-muted">
            Open Opportunities
            <BarChart3 className="h-4 w-4" />
          </div>
          <div className="mt-3 text-[22px] font-bold">{props.openCount}</div>
          <div className="mt-2 text-[12px] text-muted">{props.newThisWeek} new this week</div>
        </div>
        <div className="card p-4">
          <div className="flex items-start justify-between text-[12px] text-muted">
            Site Visits (This Week)
            <CalendarDays className="h-4 w-4" />
          </div>
          <div className="mt-3 text-[22px] font-bold">{props.visitsThisWeek}</div>
          <div className="mt-2 text-[12px] text-muted">{props.visitsTomorrow} tomorrow</div>
        </div>
        <div className="card p-4">
          <div className="flex items-start justify-between text-[12px] text-muted">
            Proposals
            <FileText className="h-4 w-4" />
          </div>
          <div className="mt-3 text-[22px] font-bold">{props.proposalsCount}</div>
          <div className="mt-2 text-[12px] text-muted">{props.proposalsViewed} viewed</div>
        </div>
        <div className="card p-4">
          <div className="flex items-start justify-between text-[12px] text-muted">
            Won (This Month)
            <Trophy className="h-4 w-4 text-warning" />
          </div>
          <div className="money mt-3 text-[18px] font-bold leading-tight">{formatCompactPKR(props.wonThisMonth)}</div>
          <div className="mt-2 text-[12px] text-muted">{props.wonDealsThisMonth} deals</div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_320px]">
        <Card>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[16px] font-semibold">Pipeline Trend</h2>
            <div className="flex gap-2 text-[11px] text-muted">
              <span className="rounded-full bg-background px-2 py-1">Last 6 months</span>
              <span className="rounded-full bg-background px-2 py-1">All sources</span>
            </div>
          </div>
          <div className="money text-[22px] font-bold">{formatCurrency(props.pipelineValue)}</div>
          <div className="mt-1 text-[12px] text-muted">
            {props.pipelineDelta == null
              ? "Opened this month vs last month unavailable"
              : `${props.pipelineDelta >= 0 ? "+" : ""}${props.pipelineDelta.toFixed(1)}% vs previous period`}
          </div>
          <div className="mt-4 h-[208px] w-full">
            <PipelineTrendChart data={props.trend} />
          </div>
        </Card>

        <Card>
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-[16px] font-semibold">Leads by Source</h2>
            <span className="rounded-full bg-background px-2 py-1 text-[11px] text-muted">This Month</span>
          </div>
          <div className="h-[200px] w-full">
            <LeadsSourceDonut data={props.sources} total={props.leadTotal} />
          </div>
          <ul className="mt-2 space-y-1.5 text-[12px]">
            {props.sources.map((s) => (
              <li key={s.name} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                  <SourceName source={s.name} />
                </span>
                <span className="font-medium">{props.leadTotal ? Math.round((s.value / props.leadTotal) * 100) : 0}%</span>
              </li>
            ))}
          </ul>
          <Link href="/reports" className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-brand">
            View Report <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-[16px] font-semibold">
              Priority Actions
              <span className="rounded-full bg-danger px-1.5 text-[10px] font-bold text-white">{props.actions.length}</span>
            </h2>
            <Link href="/tasks" className="text-[12px] font-medium text-brand">
              View all
            </Link>
          </div>
          <div className="space-y-3">
            {props.actions.length === 0 ? (
              <p className="text-sm text-muted">Nothing is blocking the pipeline right now.</p>
            ) : (
              props.actions.map((action) => (
                <Link key={action.title} href={action.href} className="flex gap-3">
                  <ActionIcon tone={action.tone} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-[13px] font-semibold leading-snug">{action.title}</div>
                      <div className="shrink-0 text-[11px] text-muted">{action.ago}</div>
                    </div>
                    <div className="mt-0.5 text-[12px] text-muted">{action.detail}</div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_320px]">
        <Card className="overflow-x-auto">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[16px] font-semibold">Recent Leads</h2>
            <Link href="/leads" className="text-[12px] font-medium text-brand">
              View all
            </Link>
          </div>
          <table className="ops w-full min-w-[640px] text-left">
            <thead>
              <tr>
                <th className="py-2">Lead</th>
                <th className="py-2">Source</th>
                <th className="py-2">Requirement</th>
                <th className="py-2">Score</th>
                <th className="py-2">Status</th>
                <th className="py-2">Owner</th>
                <th className="py-2">Date</th>
              </tr>
            </thead>
            <tbody>
              {props.recentLeads.map((lead) => (
                <tr key={lead.id} className="border-t border-border">
                  <td className="py-3">
                    <Link href={`/leads/${lead.id}`} className="flex items-center gap-2 font-medium">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand/10 text-[10px] font-bold text-brand">
                        {initials(lead.name)}
                      </span>
                      {lead.name}
                    </Link>
                  </td>
                  <td className="py-3">
                    <SourceName source={lead.source} />
                  </td>
                  <td className="py-3 text-muted">{lead.requirement}</td>
                  <td className="py-3">
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", scoreTone(lead.score))}>
                      {lead.score}
                    </span>
                  </td>
                  <td className="py-3">
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", stageTone(lead.stage))}>
                      {lead.stage}
                    </span>
                  </td>
                  <td className="py-3 text-muted">{lead.owner}</td>
                  <td className="py-3 text-muted">{lead.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[16px] font-semibold">Recent Opportunities</h2>
            <Link href="/opportunities" className="text-[12px] font-medium text-brand">
              View all
            </Link>
          </div>
          <table className="ops w-full text-left">
            <thead>
              <tr>
                <th className="py-2">Opportunity</th>
                <th className="py-2">Value</th>
                <th className="py-2">Stage</th>
                <th className="py-2">Days</th>
              </tr>
            </thead>
            <tbody>
              {props.recentOpps.map((opp) => (
                <tr key={opp.id} className="border-t border-border">
                  <td className="py-3">
                    <Link href={`/opportunities/${opp.id}`} className="font-medium">
                      {opp.name}
                    </Link>
                  </td>
                  <td className="money py-3">{formatCurrency(opp.value)}</td>
                  <td className="py-3">
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", stageTone(opp.stage, opp.won))}>
                      {opp.stage}
                    </span>
                  </td>
                  <td className="py-3 text-muted">{opp.days}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[16px] font-semibold">Upcoming Site Visits</h2>
            <Link href="/calendar" className="text-[12px] font-medium text-brand">
              View all
            </Link>
          </div>
          <div className="space-y-3">
            {props.visits.length === 0 ? (
              <p className="text-sm text-muted">No site visits on the calendar.</p>
            ) : (
              props.visits.map((visit) => (
                <div key={visit.id} className="flex gap-3">
                  <div className="flex h-12 w-12 flex-col items-center justify-center rounded-[12px] bg-brand text-white">
                    <span className="text-[14px] font-bold leading-none">{visit.day}</span>
                    <span className="mt-0.5 text-[9px] uppercase tracking-wide">{visit.month}</span>
                  </div>
                  <div>
                    <div className="text-[13px] font-semibold">{visit.title}</div>
                    <div className="text-[12px] text-muted">{visit.person}</div>
                    <div className="text-[12px] text-muted">{visit.time}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </section>

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[16px] font-semibold">Property Highlights</h2>
          <Link href="/properties" className="text-[12px] font-medium text-brand">
            View all
          </Link>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {props.properties.map((property) => (
            <Link key={property.id} href={`/properties/${property.id}`} className="overflow-hidden rounded-[12px] border border-border">
              <div className="relative h-36 bg-slate-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={property.cover} alt="" className="h-full w-full object-cover" />
                <span
                  className={cn(
                    "absolute right-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                    property.status === "AVAILABLE" ? "bg-emerald-50 text-success" : "bg-amber-50 text-warning",
                  )}
                >
                  {property.status === "AVAILABLE" ? "Available" : property.status}
                </span>
              </div>
              <div className="p-3">
                <div className="font-semibold">{property.title}</div>
                <div className="text-[12px] text-muted">{property.area}</div>
                <div className="money mt-1 text-[16px] font-bold">{formatCurrency(property.price)}</div>
                <div className="mt-1 text-[12px] text-muted">
                  {property.beds ?? "—"} Beds · {property.baths ?? "—"} Baths · {property.size}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
