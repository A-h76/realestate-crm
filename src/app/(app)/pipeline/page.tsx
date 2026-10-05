import { requireAppAccess } from "@/lib/app-access";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { PipelineBoard } from "./pipeline-board";

export default async function PipelinePage() {
  const { workspaceId } = await requireAppAccess();

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
  const oppIds = opportunities.map((o) => o.id);
  // Next action = what is actually planned: soonest open task, else next appointment, else the lead's own next action.
  const [oppTasks, oppEvents] = await Promise.all([
    prisma.task.findMany({
      where: { workspaceId, opportunityId: { in: oppIds }, deletedAt: null, status: { in: ["TODO", "IN_PROGRESS"] } },
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }],
      select: { opportunityId: true, title: true },
    }),
    prisma.calendarEvent.findMany({
      where: { workspaceId, opportunityId: { in: oppIds }, deletedAt: null, status: "SCHEDULED", startAt: { gte: new Date(nowMs) } },
      orderBy: { startAt: "asc" },
      select: { opportunityId: true, title: true },
    }),
  ]);
  const plannedByOpp = new Map<string, string>();
  for (const x of [...oppTasks, ...oppEvents]) {
    if (x.opportunityId && !plannedByOpp.has(x.opportunityId)) plannedByOpp.set(x.opportunityId, x.title);
  }
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
    nextAction: plannedByOpp.get(o.id) ?? o.lead?.nextAction ?? null,
  }));

  return (
    <div className="space-y-6 p-8">
      <PageHeader
        eyebrow="Pipeline"
        title="Pipeline"
        description="What deals are moving. Drag a deal to its next stage, or use the stage menu on a card."
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
