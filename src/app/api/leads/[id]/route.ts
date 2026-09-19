import { ApiError, jsonError, jsonOk, requirePermission } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { assertRelationsInWorkspace } from "@/lib/tenant";
import { emptyToNull } from "@/lib/validations/helpers";
import { parseBody } from "@/lib/validations/common";
import { leadUpdateSchema } from "@/lib/validations/leads";
import { runAutomations } from "@/lib/automation/engine";
import { measuredRoute } from "@/lib/perf";


type RouteContext = { params: Promise<{ id: string }> };

async function findLead(workspaceId: string, id: string) {
  const lead = await prisma.lead.findFirst({
    where: { id, workspaceId, deletedAt: null },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      account: { select: { id: true, company: true } },
      contact: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  if (!lead) throw new ApiError(404, "Lead not found");
  return lead;
}

export const GET = measuredRoute("GET /api/leads/:id", async (_request: Request, context: RouteContext) => {
  try {
    const { workspaceId } = await requirePermission("crm:read");
    const { id } = await context.params;
    const lead = await findLead(workspaceId, id);
    return jsonOk(lead);
  } catch (error) {
    return jsonError(error);
  }
});

export const PATCH = measuredRoute("PATCH /api/leads/:id", async (request: Request, context: RouteContext) => {
  try {
    const { workspaceId, userId } = await requirePermission("crm:write");
    await enforceRateLimit({ key: `mut:${workspaceId}:${userId}`, ...RATE_LIMITS.mutation });
    const { id } = await context.params;
    const existing = await findLead(workspaceId, id);
    const body = emptyToNull(parseBody(leadUpdateSchema, await request.json()));
    await assertRelationsInWorkspace(workspaceId, {
      ownerId: body.ownerId,
      accountId: body.accountId,
      contactId: body.contactId,
    });

    const updated = await prisma.lead.updateMany({
      where: { id, workspaceId, deletedAt: null },
      data: {
        ...body,
        email: body.email === undefined ? undefined : body.email || null,
      },
    });
    if (updated.count === 0) throw new ApiError(404, "Lead not found");
    const lead = await findLead(workspaceId, id);

    const stageChanged = body.stage !== undefined && body.stage !== existing.stage;

    await writeAudit({
      workspaceId,
      actorId: userId,
      action: stageChanged ? "LEAD_STAGE_CHANGED" : "LEAD_UPDATED",
      entity: "Lead",
      entityId: lead.id,
      metadata: stageChanged
        ? { from: existing.stage, to: lead.stage }
        : { fields: Object.keys(body) },
    });

    if (stageChanged && lead.stage === "QUALIFIED") {
      await runAutomations({
        workspaceId,
        actorId: userId,
        trigger: "LEAD_QUALIFIED",
        leadId: lead.id,
      });
    }

    return jsonOk(lead);
  } catch (error) {
    return jsonError(error);
  }
});

export const DELETE = measuredRoute("DELETE /api/leads/:id", async (_request: Request, context: RouteContext) => {
  try {
    const { workspaceId, userId } = await requirePermission("crm:delete");
    await enforceRateLimit({ key: `mut:${workspaceId}:${userId}`, ...RATE_LIMITS.mutation });
    const { id } = await context.params;
    await findLead(workspaceId, id);

    const result = await prisma.lead.updateMany({
      where: { id, workspaceId, deletedAt: null },
      data: { deletedAt: new Date(), stage: "ARCHIVED" },
    });
    if (result.count === 0) throw new ApiError(404, "Lead not found");

    await writeAudit({
      workspaceId,
      actorId: userId,
      action: "LEAD_ARCHIVED",
      entity: "Lead",
      entityId: id,
    });

    return jsonOk({ ok: true, id });
  } catch (error) {
    return jsonError(error);
  }
});
