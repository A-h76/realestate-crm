import type { Prisma } from "@prisma/client";
import { ApiError, jsonError, jsonOk, requirePermission } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { assertRelationsInWorkspace, touchLeadActivity } from "@/lib/tenant";
import {
  assertPropertyNotAlreadyWon,
  convertLeadOnOpportunityWon,
  lockOpportunity,
  lockProperties,
  reconcilePropertyStatus,
} from "@/lib/leads/convert-on-won";
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
  /** undefined = leave the linked property alone */
  linkedPropertyId?: string | null;
  /** Optimistic concurrency: 409 if the opportunity has already left this stage. */
  expectedStageId?: string;
}) {
  const stage = await prisma.pipelineStage.findFirst({
    where: { id: input.stageId, workspaceId: input.workspaceId, active: true },
  });
  if (!stage) throw new ApiError(400, "Invalid pipeline stage");

  const now = new Date();

  // DATA-003: stage write + property status in one transaction, with the opportunity and
  // property rows locked, so the "previous stage" we act on is current and two concurrent
  // changes touching the same property serialize instead of racing.
  const { opportunity, leadId, changed } = await prisma.$transaction(async (tx) => {
    await lockOpportunity(tx, input.workspaceId, input.opportunityId);
    const current = await tx.opportunity.findFirst({
      where: { id: input.opportunityId, workspaceId: input.workspaceId, deletedAt: null },
      include: { stage: true },
    });
    if (!current) throw new ApiError(404, "Opportunity not found");
    if (input.expectedStageId && input.expectedStageId !== current.stageId) {
      throw new ApiError(409, "This opportunity was moved by someone else. Refresh and try again.", undefined, {
        currentStageId: current.stageId,
      });
    }
    // Same stage already (a concurrent identical move won the lock first): nothing to do, no repeat side effects.
    if (current.stageId === stage.id && input.linkedPropertyId === undefined) {
      const same = await tx.opportunity.findFirstOrThrow({
        where: { id: current.id, workspaceId: input.workspaceId },
        include: { stage: true },
      });
      return { opportunity: same, leadId: current.leadId, changed: false };
    }

    const nextPropertyId = input.linkedPropertyId !== undefined ? input.linkedPropertyId : current.linkedPropertyId;
    await lockProperties(tx, input.workspaceId, [current.linkedPropertyId, nextPropertyId]);
    if (nextPropertyId && stage.isWon && (!current.stage.isWon || nextPropertyId !== current.linkedPropertyId)) {
      await assertPropertyNotAlreadyWon(tx, input.workspaceId, nextPropertyId, current.id);
    }

    await tx.opportunity.updateMany({
      where: { id: current.id, workspaceId: input.workspaceId, deletedAt: null },
      data: {
        stageId: stage.id,
        probability: stage.probability,
        stageEnteredAt: now,
        ...(input.linkedPropertyId !== undefined ? { linkedPropertyId: input.linkedPropertyId } : {}),
      },
    });

    await tx.activity.create({
      data: {
        workspaceId: input.workspaceId,
        type: "STAGE_CHANGE",
        opportunityId: current.id,
        leadId: current.leadId,
        ownerId: input.userId,
        date: now,
        status: "COMPLETED",
        title: `Stage changed to ${stage.name}`,
        notes: `Moved from ${current.stage.name} to ${stage.name}`,
        metadata: { fromStageId: current.stageId, toStageId: stage.id, probability: stage.probability },
      },
    });

    await writeAudit(
      {
        workspaceId: input.workspaceId,
        actorId: input.userId,
        action: "OPPORTUNITY_STAGE_CHANGED",
        entity: "Opportunity",
        entityId: current.id,
        metadata: {
          fromStageId: current.stageId,
          toStageId: stage.id,
          toStageName: stage.name,
          probability: stage.probability,
        },
      },
      tx,
    );

    if (current.stage.isWon || stage.isWon) {
      for (const propertyId of new Set([current.linkedPropertyId, nextPropertyId])) {
        if (!propertyId) continue;
        await reconcilePropertyStatus(tx, {
          workspaceId: input.workspaceId,
          actorId: input.userId,
          propertyId,
          opportunityId: current.id,
        });
      }
    }

    // Lead bookkeeping is part of the same transaction: a failure here rolls the whole move back
    // instead of leaving a Won opportunity with an unconverted lead.
    if (current.leadId) {
      await touchLeadActivity(input.workspaceId, current.leadId, now, tx);
      if (stage.isWon) {
        await convertLeadOnOpportunityWon(
          { workspaceId: input.workspaceId, actorId: input.userId, leadId: current.leadId, opportunityId: current.id },
          tx,
        );
      }
    }

    const updated = await tx.opportunity.findFirstOrThrow({
      where: { id: current.id, workspaceId: input.workspaceId },
      include: { stage: true },
    });
    return { opportunity: updated, leadId: current.leadId, changed: true };
  });

  // Automations run after commit (they are retry-safe: eventKey makes CREATE_TASK/NOTIFY idempotent).
  if (!changed) return opportunity;
  await runAutomations({
    workspaceId: input.workspaceId,
    actorId: input.userId,
    trigger: "STAGE_CHANGED",
    leadId,
    opportunityId: input.opportunityId,
    payload: { toStageId: stage.id, toStageName: stage.name },
    eventKey: `stage-change:${input.opportunityId}:${now.getTime()}`,
  });

  return opportunity;
}

/** Field update; re-links the property (and its status) atomically when a Won opportunity moves to another property. */
async function updateOpportunityFields(
  workspaceId: string,
  userId: string,
  id: string,
  data: Prisma.OpportunityUncheckedUpdateManyInput,
) {
  await prisma.$transaction(async (tx) => {
    await lockOpportunity(tx, workspaceId, id);
    const current = await tx.opportunity.findFirst({
      where: { id, workspaceId, deletedAt: null },
      include: { stage: true },
    });
    if (!current) throw new ApiError(404, "Opportunity not found");

    const nextPropertyId =
      data.linkedPropertyId !== undefined ? (data.linkedPropertyId as string | null) : current.linkedPropertyId;
    const relinkWon = current.stage.isWon && nextPropertyId !== current.linkedPropertyId;
    if (relinkWon) {
      await lockProperties(tx, workspaceId, [current.linkedPropertyId, nextPropertyId]);
      if (nextPropertyId) await assertPropertyNotAlreadyWon(tx, workspaceId, nextPropertyId, id);
    }

    await tx.opportunity.updateMany({ where: { id, workspaceId, deletedAt: null }, data });

    if (relinkWon) {
      for (const propertyId of [current.linkedPropertyId, nextPropertyId]) {
        if (propertyId) {
          await reconcilePropertyStatus(tx, { workspaceId, actorId: userId, propertyId, opportunityId: id });
        }
      }
    }
  });
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
      stageOnly.success && Object.keys(raw as object).every((k) => k === "stageId" || k === "expectedStageId");

    // A stage-only request is always routed through the locked transaction (which no-ops if the
    // stage already matches), so the optimistic check and idempotency hold under concurrency.
    if (isStageOnlyMove) {
      const opportunity = await applyStageChange({
        workspaceId,
        userId,
        opportunityId: id,
        stageId: stageOnly.data.stageId,
        expectedStageId: stageOnly.data.expectedStageId,
      });
      return jsonOk(opportunity);
    }

    const { expectedStageId, ...body } = emptyToNull(parseBody(opportunityUpdateSchema, raw));
    await assertRelationsInWorkspace(workspaceId, {
      accountId: body.accountId,
      primaryContactId: body.primaryContactId,
      leadId: body.leadId,
      linkedPropertyId: body.linkedPropertyId,
      stageId: body.stageId,
      ownerId: body.ownerId,
    });

    if (body.stageId && (body.stageId !== existing.stageId || expectedStageId)) {
      await applyStageChange({
        workspaceId,
        userId,
        opportunityId: id,
        stageId: body.stageId,
        linkedPropertyId: body.linkedPropertyId,
        expectedStageId,
      });

      const { stageId: _stageId, probability: _probability, linkedPropertyId: _linked, ...rest } = body;
      void _stageId;
      void _probability;
      void _linked;

      if (Object.keys(rest).length === 0) {
        return jsonOk(await findOpportunity(workspaceId, id));
      }

      await updateOpportunityFields(workspaceId, userId, id, rest);
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

    await updateOpportunityFields(workspaceId, userId, id, body);
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
    const existing = await findOpportunity(workspaceId, id);

    await prisma.$transaction(async (tx) => {
      await lockOpportunity(tx, workspaceId, id);
      await lockProperties(tx, workspaceId, [existing.linkedPropertyId]);
      const result = await tx.opportunity.updateMany({
        where: { id, workspaceId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (result.count === 0) throw new ApiError(404, "Opportunity not found");
      // A deleted Won opportunity no longer holds its property.
      if (existing.stage.isWon && existing.linkedPropertyId) {
        await reconcilePropertyStatus(tx, {
          workspaceId,
          actorId: userId,
          propertyId: existing.linkedPropertyId,
          opportunityId: id,
        });
      }
    });

    await writeAudit({
      workspaceId,
      actorId: userId,
      action: "OPPORTUNITY_UPDATED",
      entity: "Opportunity",
      entityId: id,
      metadata: { softDeleted: true },
    });

    return jsonOk({ ok: true, id });
  } catch (error) {
    return jsonError(error);
  }
});
