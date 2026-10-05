import { requireAppAccess } from "@/lib/app-access";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { localDayWindow } from "@/lib/attention/loader";
import { TasksClient } from "./tasks-client";

export default async function TasksPage() {
  const { workspaceId, workspace } = await requireAppAccess();
  const day = localDayWindow(new Date(), workspace.timezone);

  const tasks = await prisma.task.findMany({
    where: { workspaceId: workspaceId, deletedAt: null },
    orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
    take: 500,
    include: {
      owner: { select: { id: true, name: true } },
      lead: { select: { id: true, firstName: true, lastName: true } },
      opportunity: { select: { id: true, name: true } },
    },
  });

  return (
    <div className="space-y-6 p-4 md:p-8">
      <PageHeader
        eyebrow="Tasks"
        title="Tasks"
        description="What needs doing, for whom, and by when."
      />
      <TasksClient
        dayStartIso={day.start.toISOString()}
        dayEndIso={day.end.toISOString()}
        timeZone={workspace.timezone}
        initialTasks={tasks.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          status: t.status,
          priority: t.priority,
          dueAt: t.dueAt?.toISOString() ?? null,
          completedAt: t.completedAt?.toISOString() ?? null,
          ownerName: t.owner?.name ?? null,
          leadName: t.lead ? `${t.lead.firstName} ${t.lead.lastName ?? ""}`.trim() : null,
          leadId: t.lead?.id ?? null,
          opportunityName: t.opportunity?.name ?? null,
          opportunityId: t.opportunity?.id ?? null,
        }))}
      />
    </div>
  );
}
