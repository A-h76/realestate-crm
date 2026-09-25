import Link from "next/link";
import { notFound } from "next/navigation";
import { MapPin } from "lucide-react";
import { requireAppAccess } from "@/lib/app-access";
import { roleHasPermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { ActivityTimeline } from "@/components/activity-timeline";
import { LeadIntelligencePanel } from "@/components/intelligence/lead-intelligence";
import { PageHeader, SectionHeading } from "@/components/page-header";
import { SourceName } from "@/components/source-name";
import { LeadStageControl } from "@/components/leads/lead-stage-control";
import { LeadOwnerControl } from "@/components/leads/lead-owner-control";
import { WhatsAppThread } from "@/components/whatsapp/whatsapp-thread";
import { formatCurrency, formatDatePK, formatDateTimePK, formatPKR } from "@/lib/format";
import { filterAndScoreProperties } from "@/lib/matching/properties";
import { nextBestActionForLead } from "@/lib/automation/next-best-action";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const access = await requireAppAccess();
  const { id } = await params;
  const workspaceId = access.workspaceId;
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

  const scored = filterAndScoreProperties(lead, properties);
  const conversationId = `lead:${lead.id}`;
  const fullName = `${lead.firstName} ${lead.lastName ?? ""}`.trim();
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

  return (
    <div className="page-in space-y-10 p-6 md:p-10">
      <PageHeader
        eyebrow="Lead"
        title={fullName}
        description={[lead.company, lead.preferredArea, lead.intentType].filter(Boolean).join(" · ") || undefined}
        actions={
          <>
            <LeadStageControl leadId={lead.id} stage={lead.stage} />
            <LeadOwnerControl
              leadId={lead.id}
              ownerId={lead.ownerId}
              ownerName={lead.owner?.name ?? null}
              canAssign={canAssign}
              members={members.map((m) => ({ userId: m.userId, name: m.user.name, role: m.role }))}
            />
            <SourceName source={lead.source} />
          </>
        }
      />

      {nba ? (
        <div>
          <div className="section-kicker">Next best action</div>
          <Link href={nba.href} className="section mt-2 inline-block hover:text-accent">
            {nba.title}
          </Link>
          <p className="mt-1 text-[14px] leading-[22px] text-muted">{nba.reason}</p>
        </div>
      ) : null}

      <LeadIntelligencePanel
        leadId={lead.id}
        conversationId={conversationId}
        fitScore={lead.fitScore}
        intentScore={lead.intentScore}
        valueScore={lead.valueScore}
        leadScore={lead.leadScore}
        analysis={analysis}
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

      <div className="hairline" />

      <div className="grid gap-12 xl:grid-cols-3">
        <div className="space-y-10 xl:col-span-2">
          <section>
            <SectionHeading>Contact</SectionHeading>
            <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
              {[
                ["Name", fullName],
                ["Email", lead.email ?? "—"],
                ["Phone", lead.phone ?? "—"],
                ["WhatsApp", lead.whatsappNumber ?? "—"],
                ["Owner", lead.owner?.name ?? "Unassigned"],
                ["Industry", lead.industry ?? lead.account?.industry ?? "—"],
                [
                  "Budget",
                  `${formatPKR(lead.budgetMin != null ? Number(lead.budgetMin) : null)} – ${formatPKR(lead.budgetMax != null ? Number(lead.budgetMax) : null)}`,
                ],
                ["Est. value", formatCurrency(lead.estimatedValue != null ? Number(lead.estimatedValue) : null)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="section-kicker">{label}</dt>
                  <dd className="mt-1 text-sm">{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section>
            <WhatsAppThread leadId={lead.id} conversationId={conversationId} />
          </section>

          <section>
            <SectionHeading>Timeline</SectionHeading>
            <ActivityTimeline activities={lead.activities} />
          </section>
        </div>

        <div className="space-y-10">
          <section>
            <SectionHeading>Tasks</SectionHeading>
            {lead.tasks.length === 0 ? (
              <p className="text-sm text-muted">No open work on this lead.</p>
            ) : (
              <div className="divide-y divide-border">
                {lead.tasks.map((task) => (
                  <div key={task.id} className="py-3">
                    <div className="text-sm font-medium">{task.title}</div>
                    <div className="meta mt-1">
                      {task.status} · {formatDatePK(task.dueAt)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <SectionHeading>Opportunities</SectionHeading>
            {lead.opportunities.length === 0 ? (
              <Link href={`/opportunities?leadId=${lead.id}`} className="text-sm text-accent hover:underline">
                Start the first property opportunity from this lead
              </Link>
            ) : (
              <div className="divide-y divide-border">
                {lead.opportunities.map((opp) => (
                  <Link key={opp.id} href={`/opportunities/${opp.id}`} className="block py-3 hover:text-accent">
                    <div className="text-sm font-medium">{opp.name}</div>
                    <div className="meta mt-1">
                      {opp.stage.name} · {formatCurrency(Number(opp.value))}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section>
            <SectionHeading>Proposals</SectionHeading>
            {lead.proposals.length === 0 ? (
              <p className="text-sm text-muted">No proposals issued yet.</p>
            ) : (
              <div className="divide-y divide-border">
                {lead.proposals.map((p) => (
                  <div key={p.id} className="py-3">
                    <div className="text-sm font-medium">{p.proposalNumber}</div>
                    <div className="meta mt-1">
                      {p.status} · {formatCurrency(Number(p.value))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <SectionHeading>Calendar</SectionHeading>
            {lead.calendarEvents.length === 0 ? (
              <p className="text-sm text-muted">No visits or meetings scheduled.</p>
            ) : (
              <div className="divide-y divide-border">
                {lead.calendarEvents.map((ev) => (
                  <div key={ev.id} className="py-3">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {ev.title}
                      {ev.type === "SITE_VISIT" ? <MapPin className="h-3.5 w-3.5 text-accent" /> : null}
                    </div>
                    <div className="meta mt-1">{formatDateTimePK(ev.startAt)}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
