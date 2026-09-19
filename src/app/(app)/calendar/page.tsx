import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { CalendarClient } from "./calendar-client";

export default async function CalendarPage() {
  const session = await auth();
  if (!session?.user) return null;
  const workspaceId = session.user.workspaceId;

  const [events, leads, opportunities] = await Promise.all([
    prisma.calendarEvent.findMany({
      where: { workspaceId, deletedAt: null },
      orderBy: { startAt: "asc" },
      include: {
        lead: { select: { id: true, firstName: true, lastName: true } },
        opportunity: { select: { id: true, name: true } },
        owner: { select: { name: true } },
      },
    }),
    prisma.lead.findMany({
      where: { workspaceId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true },
      orderBy: { firstName: "asc" },
      take: 200,
    }),
    prisma.opportunity.findMany({
      where: { workspaceId, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 200,
    }),
  ]);

  return (
    <div className="space-y-8 p-8">
      <PageHeader
        eyebrow="Schedule"
        title="Calendar"
        description="Site visits and meetings via the demo calendar provider."
      />
      <CalendarClient
        initialEvents={events.map((ev) => ({
          id: ev.id,
          title: ev.title,
          type: ev.type,
          status: ev.status,
          startAt: ev.startAt.toISOString(),
          endAt: ev.endAt.toISOString(),
          location: ev.location,
          notes: ev.notes,
          provider: ev.provider,
          lead: ev.lead,
          opportunity: ev.opportunity,
          owner: ev.owner,
        }))}
        leads={leads}
        opportunities={opportunities}
      />
    </div>
  );
}
