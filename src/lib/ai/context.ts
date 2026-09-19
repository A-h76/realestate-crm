import type {
  Activity,
  CalendarEvent,
  Lead,
  Note,
  Opportunity,
  Property,
  Proposal,
  Task,
  WhatsAppMessage,
} from "@prisma/client";
import { prisma } from "@/lib/db";

export type LeadContext = {
  lead: Lead & {
    owner: { id: string; name: string } | null;
    account: { id: string; company: string; industry: string | null; city: string | null } | null;
    contact: { id: string; firstName: string; lastName: string | null; title: string | null } | null;
  };
  opportunities: Array<
    Opportunity & {
      stage: { id: string; name: string; slug: string; isWon: boolean; isLost: boolean };
      linkedProperty: Property | null;
    }
  >;
  activities: Activity[];
  tasks: Task[];
  proposals: Proposal[];
  calendarEvents: CalendarEvent[];
  whatsapp: WhatsAppMessage[];
  notes: Note[];
  properties: Property[];
};

export async function loadLeadContext(workspaceId: string, leadId: string): Promise<LeadContext | null> {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, workspaceId, deletedAt: null },
    include: {
      owner: { select: { id: true, name: true } },
      account: { select: { id: true, company: true, industry: true, city: true } },
      contact: { select: { id: true, firstName: true, lastName: true, title: true } },
    },
  });
  if (!lead) return null;

  const [opportunities, activities, tasks, proposals, calendarEvents, whatsapp, notes, properties] =
    await Promise.all([
      prisma.opportunity.findMany({
        where: { workspaceId, leadId, deletedAt: null },
        include: { stage: true, linkedProperty: true },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.activity.findMany({
        where: { workspaceId, leadId },
        orderBy: { date: "desc" },
        take: 40,
      }),
      prisma.task.findMany({
        where: { workspaceId, leadId, deletedAt: null },
        orderBy: { dueAt: "asc" },
        take: 20,
      }),
      prisma.proposal.findMany({
        where: { workspaceId, leadId, deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      prisma.calendarEvent.findMany({
        where: { workspaceId, leadId, deletedAt: null },
        orderBy: { startAt: "asc" },
        take: 15,
      }),
      prisma.whatsAppMessage.findMany({
        where: { workspaceId, leadId },
        orderBy: { sentAt: "asc" },
        take: 40,
      }),
      prisma.note.findMany({
        where: { workspaceId, leadId },
        orderBy: { createdAt: "desc" },
        take: 15,
      }),
      prisma.property.findMany({
        where: { workspaceId, deletedAt: null },
        take: 80,
      }),
    ]);

  return {
    lead,
    opportunities,
    activities,
    tasks,
    proposals,
    calendarEvents,
    whatsapp,
    notes,
    properties,
  };
}

export function leadDisplayName(lead: { firstName: string; lastName?: string | null }) {
  return `${lead.firstName} ${lead.lastName ?? ""}`.trim();
}

export function factList(values: Array<string | null | undefined>) {
  return values.filter((v): v is string => Boolean(v && v.trim()));
}
