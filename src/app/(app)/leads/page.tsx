import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { LeadsTable, type LeadRow } from "./leads-table";

export default async function LeadsPage() {
  const session = await auth();
  if (!session?.user) return null;

  let initialLeads: LeadRow[] | undefined;
  try {
    const leads = await prisma.lead.findMany({
      where: { workspaceId: session.user.workspaceId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: { owner: { select: { id: true, name: true } } },
    });
    initialLeads = leads.map((l) => ({
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
      nextAction: l.nextAction,
      followUpDue: l.followUpDue?.toISOString() ?? null,
      lastActivityAt: l.lastActivityAt?.toISOString() ?? null,
      createdAt: l.createdAt.toISOString(),
      estimatedValue: l.estimatedValue?.toString() ?? null,
      owner: l.owner,
    }));
  } catch {
    initialLeads = undefined;
  }

  return (
    <div className="space-y-8 p-8">
      <PageHeader
        eyebrow="Lead intake"
        title="Leads"
        description="Search, score, and work every inbound lead across WhatsApp, walk-ins, and referrals."
      />
      <LeadsTable initialLeads={initialLeads} />
    </div>
  );
}
