import { ApiError, jsonError, jsonOk, requirePermission } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { getCalendarProvider } from "@/lib/providers/calendar";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { assertRelationsInWorkspace } from "@/lib/tenant";
import { emptyToNull } from "@/lib/validations/helpers";
import { parseBody } from "@/lib/validations/common";
import { calendarUpdateSchema } from "@/lib/validations/calendar";
import { runAutomations } from "@/lib/automation/engine";
import { measuredRoute } from "@/lib/perf";


type RouteContext = { params: Promise<{ id: string }> };

export const PATCH = measuredRoute("PATCH /api/calendar/:id", async (request: Request, context: RouteContext) => {
  try {
    const { workspaceId, userId } = await requirePermission("calendar:write");
    await enforceRateLimit({ key: `mut:${workspaceId}:${userId}`, ...RATE_LIMITS.mutation });
    const { id } = await context.params;
    const body = emptyToNull(parseBody(calendarUpdateSchema, await request.json()));
    await assertRelationsInWorkspace(workspaceId, {
      ownerId: body.ownerId,
      leadId: body.leadId,
      opportunityId: body.opportunityId,
      contactId: body.contactId,
    });
    const provider = getCalendarProvider();

    const existing = await provider.getEvent(workspaceId, id);
    if (!existing) throw new ApiError(404, "Calendar event not found");

    const event = await provider.updateEvent(workspaceId, id, {
      title: body.title,
      type: body.type,
      status: body.status,
      startAt: body.startAt,
      endAt: body.endAt,
      location: body.location,
      notes: body.notes,
      ownerId: body.ownerId,
      leadId: body.leadId,
      opportunityId: body.opportunityId,
      contactId: body.contactId,
      metadata: body.metadata,
    });

    await writeAudit({
      workspaceId,
      actorId: userId,
      action: "CALENDAR_EVENT_UPDATED",
      entity: "CalendarEvent",
      entityId: event.id,
      metadata: { provider: provider.name, demo: provider.isDemo },
    });

    if (
      event.type === "SITE_VISIT" &&
      event.status === "COMPLETED" &&
      existing.status !== "COMPLETED"
    ) {
      await runAutomations({
        workspaceId,
        actorId: userId,
        trigger: "SITE_VISIT_COMPLETED",
        leadId: event.leadId,
        opportunityId: event.opportunityId,
        payload: { siteVisitId: event.id },
      });
    }

    return jsonOk({
      ...event,
      demo: provider.isDemo,
      message: provider.isDemo
        ? "Demo Calendar event updated locally. No Google sync."
        : "Calendar event updated.",
    });
  } catch (error) {
    return jsonError(error);
  }
});

export const DELETE = measuredRoute("DELETE /api/calendar/:id", async (_request: Request, context: RouteContext) => {
  try {
    const { workspaceId, userId } = await requirePermission("calendar:write");
    await enforceRateLimit({ key: `mut:${workspaceId}:${userId}`, ...RATE_LIMITS.mutation });
    const { id } = await context.params;
    const provider = getCalendarProvider();

    const existing = await provider.getEvent(workspaceId, id);
    if (!existing) throw new ApiError(404, "Calendar event not found");

    await provider.deleteEvent(workspaceId, id);

    await writeAudit({
      workspaceId,
      actorId: userId,
      action: "CALENDAR_EVENT_DELETED",
      entity: "CalendarEvent",
      entityId: id,
      metadata: { provider: provider.name, demo: provider.isDemo },
    });

    return jsonOk({
      ok: true,
      id,
      demo: provider.isDemo,
      message: provider.isDemo
        ? "Demo Calendar event deleted locally. No Google sync."
        : "Calendar event deleted.",
    });
  } catch (error) {
    return jsonError(error);
  }
});
