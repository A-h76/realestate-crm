import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { OpportunitiesClient } from "./opportunities-client";

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ leadId?: string }>;
}) {
  const session = await auth();
  if (!session?.user) return null;
  const workspaceId = session.user.workspaceId;
  const { leadId: prefillLeadId } = await searchParams;

  const [opportunities, stages, leads, properties] = await Promise.all([
    prisma.opportunity.findMany({
      where: { workspaceId, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      include: {
        stage: { select: { id: true, name: true, probability: true } },
        owner: { select: { name: true } },
        linkedProperty: { select: { id: true, title: true } },
        lead: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    prisma.pipelineStage.findMany({
      where: { workspaceId, active: true },
      orderBy: { order: "asc" },
      select: { id: true, name: true, probability: true },
    }),
    prisma.lead.findMany({
      where: { workspaceId, deletedAt: null },
      orderBy: { firstName: "asc" },
      select: { id: true, firstName: true, lastName: true },
      take: 200,
    }),
    prisma.property.findMany({
      where: { workspaceId, deletedAt: null },
      orderBy: { title: "asc" },
      select: { id: true, title: true },
      take: 200,
    }),
  ]);

  return (
    <div className="space-y-8 p-8">
      <PageHeader
        eyebrow="Deals"
        title="Opportunities"
        description="Buyer and seller deals with weighted pipeline value and stage aging."
      />
      <OpportunitiesClient
        initialOpportunities={opportunities.map((o) => ({
          id: o.id,
          name: o.name,
          dealSide: o.dealSide,
          value: o.value.toString(),
          probability: o.probability,
          stageEnteredAt: o.stageEnteredAt.toISOString(),
          createdAt: o.createdAt.toISOString(),
          expectedCloseDate: o.expectedCloseDate?.toISOString() ?? null,
          stage: o.stage,
          owner: o.owner,
          linkedProperty: o.linkedProperty,
          lead: o.lead,
        }))}
        stages={stages}
        leads={leads}
        properties={properties}
        prefillLeadId={prefillLeadId && leads.some((l) => l.id === prefillLeadId) ? prefillLeadId : null}
      />
    </div>
  );
}
