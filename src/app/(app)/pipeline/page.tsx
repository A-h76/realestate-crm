import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { PipelineBoard } from "./pipeline-board";

export default async function PipelinePage() {
  const session = await auth();
  if (!session?.user) return null;
  const workspaceId = session.user.workspaceId;

  const [stages, opportunities] = await Promise.all([
    prisma.pipelineStage.findMany({
      where: { workspaceId, active: true },
      orderBy: { order: "asc" },
    }),
    prisma.opportunity.findMany({
      where: { workspaceId, deletedAt: null },
      include: {
        stage: true,
        owner: { select: { id: true, name: true } },
        linkedProperty: { select: { id: true, title: true, area: true } },
        lead: { select: { id: true, firstName: true, lastName: true, leadScore: true, nextAction: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  // eslint-disable-next-line react-hooks/purity -- request-time snapshot for aging
  const nowMs = Date.now();
  const boardOpps = opportunities.map((o) => ({
    id: o.id,
    name: o.name,
    stageId: o.stageId,
    dealSide: o.dealSide,
    value: Number(o.value),
    probability: o.probability,
    ownerName: o.owner?.name ?? null,
    propertyTitle: o.linkedProperty?.title ?? null,
    leadName: o.lead ? `${o.lead.firstName} ${o.lead.lastName ?? ""}`.trim() : null,
    leadScore: o.lead?.leadScore ?? null,
    daysInStage: Math.max(0, Math.floor((nowMs - o.stageEnteredAt.getTime()) / 86400000)),
    nextAction: o.lead?.nextAction ?? null,
  }));

  return (
    <div className="space-y-6 p-8">
      <PageHeader
        eyebrow="Deal flow"
        title="Pipeline"
        description="Drag opportunities between stages. Moves persist to the database with activity and audit trails."
      />
      <PipelineBoard
        stages={stages.map((s) => ({
          id: s.id,
          name: s.name,
          probability: s.probability,
          accentColor: s.accentColor,
          isWon: s.isWon,
          isLost: s.isLost,
        }))}
        initialOpportunities={boardOpps}
      />
    </div>
  );
}
