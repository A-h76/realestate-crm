import { jsonError, jsonOk, requirePermission } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { getCalendarProvider } from "@/lib/providers/calendar";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { assertRelationsInWorkspace, touchLeadActivity } from "@/lib/tenant";
import { emptyToNull } from "@/lib/validations/helpers";
import { parseBody, parseQuery } from "@/lib/validations/common";
import { calendarCreateSchema, calendarListQuerySchema } from "@/lib/validations/calendar";
import { measuredRoute } from "@/lib/perf";


export const GET = measuredRoute("GET /api/calendar", async (request: Request) => {
  try {
    const { workspaceId } = await requirePermission("calendar:read");
    const query = parseQuery(calendarListQuerySchema, new URL(request.url).searchParams);
    const provider = getCalendarProvider();

    const events = await provider.listEvents(workspaceId, {
      from: query.from,
      to: query.to,
      leadId: query.leadId,
    });

    const filtered = events.filter((event) => {
      if (query.type && event.type !== query.type) return false;
      if (query.status && event.status !== query.status) return false;
      return true;
    });

    return jsonOk({
      items: filtered,
      provider: provider.name,
      demo: provider.isDemo,
      notice: provider.isDemo
        ? "Demo Calendar — events are local only; no Google Calendar sync."
        : undefined,
    });
  } catch (error) {
    return jsonError(error);
  }
});

export const POST = measuredRoute("POST /api/calendar", async (request: Request) => {
  try {
    const { workspaceId, userId } = await requirePermission("calendar:write");
    await enforceRateLimit({ key: `mut:${workspaceId}:${userId}`, ...RATE_LIMITS.mutation });
    const body = emptyToNull(parseBody(calendarCreateSchema, await request.json()));
    await assertRelationsInWorkspace(workspaceId, {
      ownerId: body.ownerId,
      leadId: body.leadId,
      opportunityId: body.opportunityId,
      contactId: body.contactId,
    });
    const provider = getCalendarProvider();

    const event = await provider.createEvent(workspaceId, {
      title: body.title,
      type: body.type ?? "MEETING",
      status: body.status,
      startAt: body.startAt,
      endAt: body.endAt,
      location: body.location,
      notes: body.notes,
      ownerId: body.ownerId ?? userId,
      leadId: body.leadId,
      opportunityId: body.opportunityId,
      contactId: body.contactId,
      metadata: body.metadata,
    });

    await writeAudit({
      workspaceId,
      actorId: userId,
      action: "CALENDAR_EVENT_CREATED",
      entity: "CalendarEvent",
      entityId: event.id,
      metadata: {
        type: event.type,
        provider: provider.name,
        demo: provider.isDemo,
      },
    });

    await prisma.activity.create({
      data: {
        workspaceId,
        type: event.type === "SITE_VISIT" ? "SITE_VISIT" : "MEETING",
        leadId: event.leadId,
        opportunityId: event.opportunityId,
        contactId: event.contactId,
        ownerId: event.ownerId ?? userId,
        date: event.startAt,
        status: "PLANNED",
        title: event.title,
        notes: event.notes,
        metadata: {
          calendarEventId: event.id,
          demo: provider.isDemo,
        },
      },
    });

    if (event.leadId) {
      await touchLeadActivity(workspaceId, event.leadId);
    }

    return jsonOk(
      {
        ...event,
        demo: provider.isDemo,
        message: provider.isDemo
          ? "Demo Calendar event generated. No external calendar was updated."
          : "Calendar event stored in CRM. Google Calendar is only updated when a user OAuth token is present.",
      },
      201,
    );
  } catch (error) {
    return jsonError(error);
  }
});
