import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { TasksClient } from "./tasks-client";

export default async function TasksPage() {
  const session = await auth();
  if (!session?.user) return null;

  const tasks = await prisma.task.findMany({
    where: { workspaceId: session.user.workspaceId, deletedAt: null },
    orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
    include: {
      owner: { select: { id: true, name: true } },
      lead: { select: { id: true, firstName: true, lastName: true } },
      opportunity: { select: { id: true, name: true } },
    },
  });

  return (
    <div className="space-y-8 p-8">
      <PageHeader
        eyebrow="Execution"
        title="Tasks"
        description="Today, upcoming, overdue, and completed work across leads, opportunities, and site visits."
      />
      <TasksClient
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
          opportunityName: t.opportunity?.name ?? null,
        }))}
      />
    </div>
  );
}
