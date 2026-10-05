import Link from "next/link";
import { notFound } from "next/navigation";
import { MapPin, Phone, MessageCircle, CalendarPlus, ListPlus, Ellipsis } from "lucide-react";
import { requireAppAccess } from "@/lib/app-access";
import { roleHasPermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { ActivityTimeline } from "@/components/activity-timeline";
import { LeadIntelligencePanel } from "@/components/intelligence/lead-intelligence";
import { LogActivityForm } from "@/components/leads/log-activity-form";
import { AddTaskForm } from "@/components/leads/add-task-form";
import { SectionHeading } from "@/components/page-header";
import { SourceName } from "@/components/source-name";
import { LeadStageControl } from "@/components/leads/lead-stage-control";
import { LeadOwnerControl } from "@/components/leads/lead-owner-control";
import { WhatsAppThread } from "@/components/whatsapp/whatsapp-thread";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMoney, formatDate, formatDateTime } from "@/lib/format";
import { filterAndScoreProperties } from "@/lib/matching/properties";
import { nextBestActionForLead } from "@/lib/automation/next-best-action";
import { loadLeadAttentionMap } from "@/lib/attention/loader";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "conversation", label: "Conversation" },
  { key: "activity", label: "Activity" },
  { key: "properties", label: "Properties" },
  { key: "tasks", label: "Tasks" },
  { key: "appointments", label: "Appointments" },
  { key: "opportunity", label: "Opportunity" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const INTENT_LABEL: Record<string, string> = {
  BUY: "Buyer",
  SELL: "Seller",
  RENT: "Renter",
  INVEST: "Investor",
  UNKNOWN: "Lead",
};

function requirementsSummary(lead: {
  budgetMin: unknown;
  budgetMax: unknown;
  bedroomPref: number | null;
  bathroomPref: number | null;
  propertyTypePref: string | null;
  preferredArea: string | null;
  timeline: string | null;
}) {
  const min = lead.budgetMin != null ? Number(lead.budgetMin) : null;
  const max = lead.budgetMax != null ? Number(lead.budgetMax) : null;
  const budget =
    min != null && max != null ? `${formatMoney(min)} – ${formatMoney(max)}` : max != null ? `Up to ${formatMoney(max)}` : min != null ? `From ${formatMoney(min)}` : null;
  return [
    budget,
    lead.bedroomPref != null ? `${lead.bedroomPref}+ beds` : null,
    lead.bathroomPref != null ? `${lead.bathroomPref}+ baths` : null,
    lead.propertyTypePref ? lead.propertyTypePref.replaceAll("_", " ").toLowerCase() : null,
    lead.preferredArea,
    lead.timeline,
  ].filter((v): v is string => Boolean(v));
}

export default async function LeadDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const access = await requireAppAccess();
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const tab: TabKey = TABS.some((t) => t.key === tabParam) ? (tabParam as TabKey) : "overview";
  const workspaceId = access.workspaceId;
  const tz = access.workspace.timezone;
  const canAssign = roleHasPermission(access.role, "leads:assign");

  const lead = await prisma.lead.findFirst({
    where: { id, workspaceId, deletedAt: null },
    include: {
      owner: true,
      account: true,
      contact: true,
      activities: {
        orderBy: { date: "desc" },
        take: 30,
        include: { owner: { select: { name: true } } },
      },
      tasks: {
        where: { deletedAt: null },
        orderBy: { dueAt: "asc" },
        take: 20,
        include: { owner: { select: { name: true } } },
      },
      opportunities: {
        where: { deletedAt: null },
        include: { stage: true, linkedProperty: true },
        orderBy: { updatedAt: "desc" },
      },
      proposals: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 10,
      },
      calendarEvents: {
        where: { deletedAt: null },
        orderBy: { startAt: "asc" },
        take: 10,
      },
      noteEntries: {
        orderBy: { createdAt: "desc" },
        take: 15,
        include: { author: { select: { name: true } } },
      },
    },
  });

  if (!lead) notFound();

  const [analysisRun, history, properties, nba, members] = await Promise.all([
    prisma.intelligenceRun.findFirst({
      where: { workspaceId, leadId: lead.id, kind: "LEAD_ANALYSIS" },
      orderBy: { createdAt: "desc" },
    }),
    prisma.scoreHistory.findMany({
      where: { workspaceId, leadId: lead.id },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.property.findMany({ where: { workspaceId, deletedAt: null } }),
    nextBestActionForLead(workspaceId, lead.id),
    canAssign
      ? prisma.workspaceMember.findMany({
          where: { workspaceId, role: { not: "VIEWER" } },
          select: { userId: true, role: true, user: { select: { name: true } } },
          orderBy: { createdAt: "asc" },
        })
      : [],
  ]);

  const reviewer = analysisRun?.reviewedById
    ? await prisma.user.findUnique({ where: { id: analysisRun.reviewedById }, select: { name: true } })
    : null;
  const scored = filterAndScoreProperties(lead, properties);
  const attention = (
    await loadLeadAttentionMap(workspaceId, [lead], tz, new Date(), new Map([[lead.id, scored.length]]))
  ).get(lead.id)!;
  const conversationId = `lead:${lead.id}`;
  const fullName = `${lead.firstName} ${lead.lastName ?? ""}`.trim();
  const requirements = requirementsSummary(lead);
  const phone = lead.phone ?? lead.whatsappNumber;
  const openTasks = lead.tasks.filter((t) => t.status === "TODO" || t.status === "IN_PROGRESS");
  const now = new Date();
  const next = attention.nextAction;
  const analysis = analysisRun?.output as {
    fitScore: number;
    intentScore: number;
    valueScore: number;
    confidence: number;
    niche: string;
    likelyNeed: string;
    painPoints: string[];
    recommendedAction: string;
    reasoning: string;
  } | null;

  const counts: Partial<Record<TabKey, number>> = {
    tasks: openTasks.length,
    appointments: lead.calendarEvents.length,
    opportunity: lead.opportunities.length,
    properties: scored.length,
  };

  return (
    <div className="page-in space-y-6 p-4 md:p-10">
      <Link href="/leads" className="text-[12px] text-muted hover:text-foreground">
        ← Leads
      </Link>

      <header className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[28px] font-bold tracking-tight md:text-[32px]">{fullName}</h1>
            <p className="mt-1 text-[14px] text-muted">
              {[INTENT_LABEL[lead.intentType] ?? "Lead", lead.preferredArea].filter(Boolean).join(" · ")}
              {lead.company ? ` · ${lead.company}` : ""}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge tone={attention.state === "Needs Attention" ? "danger" : attention.state === "Active" ? "success" : attention.state === "Cold" ? "warning" : "neutral"}>
                {attention.state}
              </Badge>
              <Badge>{lead.stage.replaceAll("_", " ")}</Badge>
              <span className="meta">Owner: {lead.owner?.name ?? "Unassigned"}</span>
              <SourceName source={lead.source} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {phone ? (
              <Button asChild size="sm" variant="accent">
                <a href={`tel:${phone}`}>
                  <Phone className="h-4 w-4" aria-hidden /> Call
                </a>
              </Button>
            ) : (
              <Button size="sm" variant="outline" disabled title="No phone number on file">
                <Phone className="h-4 w-4" aria-hidden /> Call
              </Button>
            )}
            <Button asChild size="sm" variant="outline">
              <Link href={`/conversations?lead=${lead.id}`}>
                <MessageCircle className="h-4 w-4" aria-hidden /> Message
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={`/leads/${lead.id}?tab=tasks#add-task`}>
                <ListPlus className="h-4 w-4" aria-hidden /> Add task
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={`/calendar?leadId=${lead.id}`}>
                <CalendarPlus className="h-4 w-4" aria-hidden /> Schedule
              </Link>
            </Button>
            <details className="relative">
              <summary className="inline-flex h-8 cursor-pointer list-none items-center gap-1 rounded-[12px] border border-border bg-surface px-3 text-[12px] font-medium hover:bg-background">
                <Ellipsis className="h-4 w-4" aria-hidden /> More
              </summary>
              <div className="absolute right-0 z-20 mt-1 w-64 space-y-3 rounded-xl border border-border bg-surface p-3 shadow-lg">
                <div>
                  <div className="section-kicker mb-1">Stage</div>
                  <LeadStageControl leadId={lead.id} stage={lead.stage} />
                </div>
                <div>
                  <div className="section-kicker mb-1">Owner</div>
                  <LeadOwnerControl
                    leadId={lead.id}
                    ownerId={lead.ownerId}
                    ownerName={lead.owner?.name ?? null}
                    canAssign={canAssign}
                    members={members.map((m) => ({ userId: m.userId, name: m.user.name, role: m.role }))}
                  />
                </div>
              </div>
            </details>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <section aria-label="Requirements" className="rounded-xl border border-border bg-surface px-4 py-3">
            <div className="section-kicker">Requirements</div>
            {requirements.length === 0 ? (
              <p className="mt-1 text-sm text-muted">Not captured yet. Ask what they are looking for.</p>
            ) : (
              <p className="mt-1 text-[15px] font-medium">{requirements.join(" · ")}</p>
            )}
          </section>
          <section aria-label="Next action" className="rounded-xl border border-border bg-surface px-4 py-3">
            <div className="section-kicker">Next action</div>
            {next ? (
              <>
                <p className="mt-1 text-[15px] font-medium">{next.label}</p>
                <p className="meta mt-0.5">
                  {next.due ? `Due ${formatDate(next.due, tz)}` : "No due date"} · Owner: {next.ownerName ?? "Unassigned"} · {next.reason}
                </p>
              </>
            ) : (
              <>
                <p className="mt-1 text-[15px] font-medium text-warning">No next action</p>
                <p className="meta mt-0.5">
                  {nba ? `Suggestion: ${nba.title}. ${nba.reason}` : "Add a task so this lead does not slip."}
                </p>
              </>
            )}
          </section>
        </div>
      </header>

      <nav aria-label="Lead sections" className="-mx-4 flex gap-1 overflow-x-auto border-b border-border px-4 md:mx-0 md:px-0">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key === "overview" ? `/leads/${lead.id}` : `/leads/${lead.id}?tab=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={`shrink-0 border-b-2 px-3 py-2 text-[13px] font-medium ${
              tab === t.key ? "border-brand text-foreground" : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {t.label}
            {counts[t.key] ? <span className="ml-1.5 text-[11px] text-muted">{counts[t.key]}</span> : null}
          </Link>
        ))}
      </nav>

      {tab === "overview" ? (
        <div className="grid gap-10 xl:grid-cols-2">
          <section>
            <SectionHeading>Why this lead matters</SectionHeading>
            {attention.priority.reasons.length === 0 ? (
              <p className="text-sm text-muted">Nothing is pressing on this lead right now.</p>
            ) : (
              <>
                <p className="mb-2 text-[13px] font-semibold">
                  {attention.priority.level === "high" ? "High priority" : attention.priority.level === "lower" ? "Lower priority" : "Normal priority"}
                </p>
                <ul className="space-y-1 text-sm text-muted">
                  {attention.priority.reasons.map((r) => (
                    <li key={r}>• {r}</li>
                  ))}
                </ul>
              </>
            )}
          </section>
          <section>
            <SectionHeading>Contact</SectionHeading>
            <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
              {[
                ["Email", lead.email ?? "—"],
                ["Phone", lead.phone ?? "—"],
                ["WhatsApp", lead.whatsappNumber ?? "—"],
                ["Owner", lead.owner?.name ?? "Unassigned"],
                ["Est. value", formatMoney(lead.estimatedValue != null ? Number(lead.estimatedValue) : null)],
                ["Added", formatDate(lead.createdAt, tz)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="section-kicker">{label}</dt>
                  <dd className="mt-1 break-words text-sm">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      ) : null}

      {tab === "conversation" ? (
        <section>
          <WhatsAppThread leadId={lead.id} conversationId={conversationId} />
        </section>
      ) : null}

      {tab === "activity" ? (
        <section>
          <SectionHeading>Activity</SectionHeading>
          <ActivityTimeline activities={lead.activities} />
          <LogActivityForm leadId={lead.id} />
        </section>
      ) : null}

      {tab === "properties" ? (
        <LeadIntelligencePanel
          leadId={lead.id}
          conversationId={conversationId}
          fitScore={lead.fitScore}
          intentScore={lead.intentScore}
          valueScore={lead.valueScore}
          leadScore={lead.leadScore}
          analysis={analysis}
          analysisRun={
            analysisRun
              ? {
                  id: analysisRun.id,
                  status: analysisRun.status,
                  reviewedBy: reviewer?.name ?? null,
                  reviewedAt: analysisRun.reviewedAt?.toISOString() ?? null,
                }
              : null
          }
          matches={scored.map((m) => ({
            property: {
              id: m.property.id,
              title: m.property.title,
              area: m.property.area,
              price: Number(m.property.price),
              bedrooms: m.property.bedrooms,
              bathrooms: m.property.bathrooms,
              status: m.property.status,
              propertyType: m.property.propertyType,
            },
            matchScore: m.matchScore,
            reasons: m.reasons,
            caution: m.caution,
          }))}
          history={history.map((h) => ({
            previousScore: h.previousScore,
            newScore: h.newScore,
            reason: h.reason,
            createdAt: h.createdAt.toISOString(),
          }))}
        />
      ) : null}

      {tab === "tasks" ? (
        <section>
          <SectionHeading>Tasks</SectionHeading>
          {lead.tasks.length === 0 ? (
            <p className="text-sm text-muted">You&apos;re all caught up. Add a task to plan the next step.</p>
          ) : (
            <div className="divide-y divide-border">
              {lead.tasks.map((task) => {
                const open = task.status === "TODO" || task.status === "IN_PROGRESS";
                const overdue = open && task.dueAt != null && task.dueAt < now;
                return (
                  <div key={task.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {task.title}
                      {overdue ? <Badge tone="danger">Overdue</Badge> : null}
                      {!open ? <Badge tone="success">{task.status === "DONE" ? "Done" : "Cancelled"}</Badge> : null}
                    </div>
                    <div className="meta mt-1">
                      {task.dueAt ? `Due ${formatDate(task.dueAt, tz)}` : "No due date"} · {task.owner?.name ?? "Unassigned"}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <AddTaskForm leadId={lead.id} />
        </section>
      ) : null}

      {tab === "appointments" ? (
        <section>
          <SectionHeading>Appointments</SectionHeading>
          {lead.calendarEvents.length === 0 ? (
            <p className="text-sm text-muted">Nothing scheduled with this lead.</p>
          ) : (
            <div className="divide-y divide-border">
              {lead.calendarEvents.map((ev) => (
                <div key={ev.id} className="py-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {ev.title}
                    {ev.type === "SITE_VISIT" ? <MapPin className="h-3.5 w-3.5 text-accent" aria-label="Showing" /> : null}
                  </div>
                  <div className="meta mt-1">{formatDateTime(ev.startAt, tz)}</div>
                </div>
              ))}
            </div>
          )}
          <Button asChild size="sm" variant="outline" className="mt-4">
            <Link href={`/calendar?leadId=${lead.id}`}>Schedule in calendar</Link>
          </Button>
        </section>
      ) : null}

      {tab === "opportunity" ? (
        <div className="grid gap-10 xl:grid-cols-2">
          <section>
            <SectionHeading>Opportunity</SectionHeading>
            {lead.opportunities.length === 0 ? (
              <Link href={`/opportunities?leadId=${lead.id}`} className="text-sm text-accent-text hover:underline">
                Start the first opportunity from this lead
              </Link>
            ) : (
              <div className="divide-y divide-border">
                {lead.opportunities.map((opp) => (
                  <Link key={opp.id} href={`/opportunities/${opp.id}`} className="block py-3 hover:text-accent">
                    <div className="text-sm font-medium">{opp.name}</div>
                    <div className="meta mt-1">
                      {opp.stage.name} · {formatMoney(Number(opp.value))}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
          <section>
            <SectionHeading>Proposals</SectionHeading>
            {lead.proposals.length === 0 ? (
              <p className="text-sm text-muted">No proposals sent yet.</p>
            ) : (
              <div className="divide-y divide-border">
                {lead.proposals.map((p) => (
                  <div key={p.id} className="py-3">
                    <div className="text-sm font-medium">{p.proposalNumber}</div>
                    <div className="meta mt-1">
                      {p.status} · {formatMoney(Number(p.value))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
