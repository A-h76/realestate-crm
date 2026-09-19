import type { CalendarEvent, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type {
  CalendarEventInput,
  CalendarEventUpdate,
  CalendarProvider,
} from "./types";

export class DemoCalendarProvider implements CalendarProvider {
  readonly name = "demo";
  readonly isDemo = true;

  async createEvent(workspaceId: string, input: CalendarEventInput): Promise<CalendarEvent> {
    return prisma.calendarEvent.create({
      data: {
        workspaceId,
        title: input.title,
        type: input.type,
        status: input.status ?? "SCHEDULED",
        startAt: input.startAt,
        endAt: input.endAt,
        location: input.location,
        notes: input.notes,
        ownerId: input.ownerId,
        leadId: input.leadId,
        opportunityId: input.opportunityId,
        contactId: input.contactId,
        provider: "demo",
        externalEventId: `demo-cal-${crypto.randomUUID()}`,
        metadata: {
          ...(input.metadata ?? {}),
          demoNotice: "Demo Calendar event generated. No external calendar was updated.",
        } as Prisma.InputJsonValue,
      },
    });
  }

  async updateEvent(
    workspaceId: string,
    eventId: string,
    input: CalendarEventUpdate,
  ): Promise<CalendarEvent> {
    const existing = await prisma.calendarEvent.findFirst({
      where: { id: eventId, workspaceId, deletedAt: null },
    });
    if (!existing) throw new Error("Calendar event not found");

    const nextMetadata = input.metadata
      ? ({
          ...(typeof existing.metadata === "object" && existing.metadata
            ? (existing.metadata as Record<string, unknown>)
            : {}),
          ...input.metadata,
        } as Prisma.InputJsonValue)
      : undefined;

    const result = await prisma.calendarEvent.updateMany({
      where: { id: eventId, workspaceId, deletedAt: null },
      data: {
        title: input.title,
        type: input.type,
        status: input.status,
        startAt: input.startAt,
        endAt: input.endAt,
        location: input.location,
        notes: input.notes,
        ownerId: input.ownerId,
        leadId: input.leadId,
        opportunityId: input.opportunityId,
        contactId: input.contactId,
        metadata: nextMetadata,
      },
    });
    if (result.count === 0) throw new Error("Calendar event not found");
    return prisma.calendarEvent.findFirstOrThrow({
      where: { id: eventId, workspaceId },
    });
  }

  async deleteEvent(workspaceId: string, eventId: string): Promise<void> {
    await prisma.calendarEvent.updateMany({
      where: { id: eventId, workspaceId },
      data: { deletedAt: new Date(), status: "CANCELLED" },
    });
  }

  async listEvents(
    workspaceId: string,
    opts?: { from?: Date; to?: Date; leadId?: string },
  ): Promise<CalendarEvent[]> {
    return prisma.calendarEvent.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        leadId: opts?.leadId,
        startAt: {
          gte: opts?.from,
          lte: opts?.to,
        },
      },
      orderBy: { startAt: "asc" },
    });
  }

  async getEvent(workspaceId: string, eventId: string): Promise<CalendarEvent | null> {
    return prisma.calendarEvent.findFirst({
      where: { id: eventId, workspaceId, deletedAt: null },
    });
  }
}
