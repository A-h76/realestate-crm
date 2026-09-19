import { ApiError, jsonError, jsonOk, requirePermission } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { assertRelationsInWorkspace, touchLeadActivity } from "@/lib/tenant";
import { emptyToNull } from "@/lib/validations/helpers";
import { parseBody } from "@/lib/validations/common";
import {
  opportunityStagePatchSchema,
  opportunityUpdateSchema,
} from "@/lib/validations/opportunities";
import { runAutomations } from "@/lib/automation/engine";
import { measuredRoute } from "@/lib/perf";


type RouteContext = { params: Promise<{ id: string }> };

async function findOpportunity(workspaceId: string, id: string) {
  const opportunity = await prisma.opportunity.findFirst({
    where: { id, workspaceId, deletedAt: null },
    include: {
      stage: true,
      owner: { select: { id: true, name: true } },
      lead: { select: { id: true, firstName: true, lastName: true } },
      linkedProperty: { select: { id: true, title: true } },
      primaryContact: { select: { id: true, firstName: true, lastName: true } },
      account: { select: { id: true, company: true } },
    },
  });
  if (!opportunity) throw new ApiError(404, "Opportunity not found");
  return opportunity;
}

async function applyStageChange(input: {
  workspaceId: string;
  userId: string;
  opportunityId: string;
  stageId: string;
  existingStageId: string;
  existingStageName: string;
  leadId: string | null;
}) {
  const stage = await prisma.pipelineStage.findFirst({
    where: { id: input.stageId, workspaceId: input.workspaceId, active: true },
  });
  if (!stage) throw new ApiError(400, "Invalid pipeline stage");

  const now = new Date();

  const result = await prisma.opportunity.updateMany({
    where: { id: input.opportunityId, workspaceId: input.workspaceId, deletedAt: null },
    data: {
      stageId: stage.id,
      probability: stage.probability,
      stageEnteredAt: now,
    },
  });
  if (result.count === 0) throw new ApiError(404, "Opportunity not found");
  const opportunity = await prisma.opportunity.findFirstOrThrow({
    where: { id: input.opportunityId, workspaceId: input.workspaceId },
    include: { stage: true },
  });

  await prisma.activity.create({
    data: {
      workspaceId: input.workspaceId,
      type: "STAGE_CHANGE",
      opportunityId: opportunity.id,
      leadId: input.leadId,
      ownerId: input.userId,
      date: now,
      status: "COMPLETED",
      title: `Stage changed to ${stage.name}`,
      notes: `Moved from ${input.existingStageName} to ${stage.name}`,
      metadata: {
        fromStageId: input.existingStageId,
        toStageId: stage.id,
        probability: stage.probability,
      },
    },
  });

  await writeAudit({
    workspaceId: input.workspaceId,
    actorId: input.userId,
    action: "OPPORTUNITY_STAGE_CHANGED",
    entity: "Opportunity",
    entityId: opportunity.id,
    metadata: {
      fromStageId: input.existingStageId,
      toStageId: stage.id,
      toStageName: stage.name,
      probability: stage.probability,
    },
  });

  if (input.leadId) {
    await touchLeadActivity(input.workspaceId, input.leadId, now);
  }

  await runAutomations({
    workspaceId: input.workspaceId,
    actorId: input.userId,
    trigger: "STAGE_CHANGED",
    leadId: input.leadId,
    opportunityId: input.opportunityId,
    payload: { toStageId: stage.id, toStageName: stage.name },
  });

  return opportunity;
}

export const GET = measuredRoute("GET /api/opportunities/:id", async (_request: Request, context: RouteContext) => {
  try {
    const { workspaceId } = await requirePermission("crm:read");
    const { id } = await context.params;
    return jsonOk(await findOpportunity(workspaceId, id));
  } catch (error) {
    return jsonError(error);
  }
});

export const PATCH = measuredRoute("PATCH /api/opportunities/:id", async (request: Request, context: RouteContext) => {
  try {
    const { workspaceId, userId } = await requirePermission("crm:write");
    await enforceRateLimit({ key: `mut:${workspaceId}:${userId}`, ...RATE_LIMITS.mutation });
    const { id } = await context.params;
    const existing = await findOpportunity(workspaceId, id);
    const raw = await request.json();

    const stageOnly = opportunityStagePatchSchema.safeParse(raw);
    const isStageOnlyMove =
      stageOnly.success && Object.keys(raw as object).every((k) => k === "stageId");

    if (isStageOnlyMove && stageOnly.data.stageId !== existing.stageId) {
      const opportunity = await applyStageChange({
        workspaceId,
        userId,
        opportunityId: id,
        stageId: stageOnly.data.stageId,
        existingStageId: existing.stageId,
        existingStageName: existing.stage.name,
        leadId: existing.leadId,
      });
      return jsonOk(opportunity);
    }

    const body = emptyToNull(parseBody(opportunityUpdateSchema, raw));
    await assertRelationsInWorkspace(workspaceId, {
      accountId: body.accountId,
      primaryContactId: body.primaryContactId,
      leadId: body.leadId,
      linkedPropertyId: body.linkedPropertyId,
      stageId: body.stageId,
      ownerId: body.ownerId,
    });

    if (body.stageId && body.stageId !== existing.stageId) {
      await applyStageChange({
        workspaceId,
        userId,
        opportunityId: id,
        stageId: body.stageId,
        existingStageId: existing.stageId,
        existingStageName: existing.stage.name,
        leadId: existing.leadId,
      });

      const { stageId: _stageId, probability: _probability, ...rest } = body;
      void _stageId;
      void _probability;

      if (Object.keys(rest).length === 0) {
        return jsonOk(await findOpportunity(workspaceId, id));
      }

      const updated = await prisma.opportunity.updateMany({
        where: { id, workspaceId, deletedAt: null },
        data: rest,
      });
      if (updated.count === 0) throw new ApiError(404, "Opportunity not found");
      const opportunity = await findOpportunity(workspaceId, id);

      await writeAudit({
        workspaceId,
        actorId: userId,
        action: "OPPORTUNITY_UPDATED",
        entity: "Opportunity",
        entityId: opportunity.id,
        metadata: { fields: Object.keys(rest) },
      });

      return jsonOk(opportunity);
    }

    const updated = await prisma.opportunity.updateMany({
      where: { id, workspaceId, deletedAt: null },
      data: body,
    });
    if (updated.count === 0) throw new ApiError(404, "Opportunity not found");
    const opportunity = await findOpportunity(workspaceId, id);

    await writeAudit({
      workspaceId,
      actorId: userId,
      action: "OPPORTUNITY_UPDATED",
      entity: "Opportunity",
      entityId: opportunity.id,
      metadata: { fields: Object.keys(body) },
    });

    return jsonOk(opportunity);
  } catch (error) {
    return jsonError(error);
  }
});

export const DELETE = measuredRoute("DELETE /api/opportunities/:id", async (_request: Request, context: RouteContext) => {
  try {
    const { workspaceId, userId } = await requirePermission("crm:delete");
    await enforceRateLimit({ key: `mut:${workspaceId}:${userId}`, ...RATE_LIMITS.mutation });
    const { id } = await context.params;
    await findOpportunity(workspaceId, id);

    const result = await prisma.opportunity.updateMany({
      where: { id, workspaceId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (result.count === 0) throw new ApiError(404, "Opportunity not found");
    const opportunity = { id };

    await writeAudit({
      workspaceId,
      actorId: userId,
      action: "OPPORTUNITY_UPDATED",
      entity: "Opportunity",
      entityId: opportunity.id,
      metadata: { softDeleted: true },
    });

    return jsonOk({ ok: true, id: opportunity.id });
  } catch (error) {
    return jsonError(error);
  }
});
