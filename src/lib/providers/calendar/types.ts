import type {
  CalendarEvent,
  CalendarEventStatus,
  CalendarEventType,
} from "@prisma/client";

export type CalendarEventInput = {
  title: string;
  type: CalendarEventType;
  status?: CalendarEventStatus;
  startAt: Date;
  endAt: Date;
  location?: string | null;
  notes?: string | null;
  ownerId?: string | null;
  leadId?: string | null;
  opportunityId?: string | null;
  contactId?: string | null;
  metadata?: Record<string, unknown>;
};

export type CalendarEventUpdate = Partial<CalendarEventInput>;

export interface CalendarProvider {
  readonly name: string;
  readonly isDemo: boolean;
  createEvent(workspaceId: string, input: CalendarEventInput): Promise<CalendarEvent>;
  updateEvent(
    workspaceId: string,
    eventId: string,
    input: CalendarEventUpdate,
  ): Promise<CalendarEvent>;
  deleteEvent(workspaceId: string, eventId: string): Promise<void>;
  listEvents(
    workspaceId: string,
    opts?: { from?: Date; to?: Date; leadId?: string },
  ): Promise<CalendarEvent[]>;
  getEvent(workspaceId: string, eventId: string): Promise<CalendarEvent | null>;
}
