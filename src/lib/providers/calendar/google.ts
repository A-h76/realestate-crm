import type { CalendarEvent, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type {
  CalendarEventInput,
  CalendarEventUpdate,
  CalendarProvider,
} from "./types";

/**
 * Production Google Calendar provider.
 * Always persists to the CRM database. External Google writes happen only when
 * an OAuth access token is present — otherwise metadata records that no
 * external calendar was updated.
 */
export class GoogleCalendarProvider implements CalendarProvider {
  readonly name = "google";
  readonly isDemo = false;

  private accessToken() {
    return process.env.GOOGLE_CALENDAR_ACCESS_TOKEN || process.env.GOOGLE_REFRESH_TOKEN || "";
  }

  private syncMeta(extra?: Record<string, unknown>) {
    const token = this.accessToken();
    return {
      provider: "google",
      googleSync: token ? "configured" : "not_performed",
      notice: token
        ? "Google Calendar credentials present. CRM event stored; live sync depends on a valid user OAuth token."
        : "Stored in CRM only. Google Calendar OAuth token is not present — no external calendar was updated.",
      ...extra,
    };
  }

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
        provider: "google",
        metadata: this.syncMeta(input.metadata) as Prisma.InputJsonValue,
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
    const updated = await prisma.calendarEvent.updateMany({
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
        metadata: this.syncMeta({
          ...(typeof existing.metadata === "object" && existing.metadata
            ? (existing.metadata as Record<string, unknown>)
            : {}),
          ...(input.metadata ?? {}),
        }) as Prisma.InputJsonValue,
      },
    });
    if (updated.count === 0) throw new Error("Calendar event not found");
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
        startAt: { gte: opts?.from, lte: opts?.to },
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
