import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { ProposalsClient } from "./proposals-client";

export default async function ProposalsPage() {
  const session = await auth();
  if (!session?.user) return null;
  const workspaceId = session.user.workspaceId;

  const [proposals, opportunities, properties, leads] = await Promise.all([
    prisma.proposal.findMany({
      where: { workspaceId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: {
        lead: { select: { id: true, firstName: true, lastName: true } },
        opportunity: { select: { id: true, name: true } },
        linkedProperty: { select: { id: true, title: true } },
        owner: { select: { id: true, name: true } },
      },
    }),
    prisma.opportunity.findMany({
      where: { workspaceId, deletedAt: null },
      select: { id: true, name: true, value: true, leadId: true, linkedPropertyId: true },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
    prisma.property.findMany({
      where: { workspaceId, deletedAt: null },
      select: { id: true, title: true },
      take: 50,
    }),
    prisma.lead.findMany({
      where: { workspaceId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true },
      take: 50,
    }),
  ]);

  return (
    <div className="space-y-8 p-8">
      <PageHeader
        eyebrow="Commercial"
        title="Proposals"
        description="Track draft → sent → viewed → negotiation. Marking SENT creates a follow-up task."
      />
      <ProposalsClient
        initialProposals={proposals.map((p) => ({
          id: p.id,
          proposalNumber: p.proposalNumber,
          status: p.status,
          value: Number(p.value),
          viewCount: p.viewCount,
          sentAt: p.sentAt?.toISOString() ?? null,
          viewedAt: p.viewedAt?.toISOString() ?? null,
          expiryAt: p.expiryAt?.toISOString() ?? null,
          leadName: p.lead ? `${p.lead.firstName} ${p.lead.lastName ?? ""}`.trim() : null,
          opportunityName: p.opportunity?.name ?? null,
          propertyTitle: p.linkedProperty?.title ?? null,
          ownerName: p.owner?.name ?? null,
        }))}
        opportunities={opportunities.map((o) => ({
          id: o.id,
          name: o.name,
          value: Number(o.value),
          leadId: o.leadId,
          linkedPropertyId: o.linkedPropertyId,
        }))}
        properties={properties}
        leads={leads.map((l) => ({
          id: l.id,
          name: `${l.firstName} ${l.lastName ?? ""}`.trim(),
        }))}
      />
    </div>
  );
}
