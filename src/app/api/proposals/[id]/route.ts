import { ApiError, jsonError, jsonOk, requirePermission } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { assertRelationsInWorkspace } from "@/lib/tenant";
import { emptyToNull } from "@/lib/validations/helpers";
import { parseBody } from "@/lib/validations/common";
import { proposalUpdateSchema } from "@/lib/validations/proposals";
import { runAutomations } from "@/lib/automation/engine";
import { measuredRoute } from "@/lib/perf";


type RouteContext = { params: Promise<{ id: string }> };

async function findProposal(workspaceId: string, id: string) {
  const proposal = await prisma.proposal.findFirst({
    where: { id, workspaceId, deletedAt: null },
    include: {
      owner: { select: { id: true, name: true } },
      lead: { select: { id: true, firstName: true, lastName: true } },
      opportunity: { select: { id: true, name: true } },
      linkedProperty: { select: { id: true, title: true } },
    },
  });
  if (!proposal) throw new ApiError(404, "Proposal not found");
  return proposal;
}

export const GET = measuredRoute("GET /api/proposals/:id", async (_request: Request, context: RouteContext) => {
  try {
    const { workspaceId } = await requirePermission("crm:read");
    const { id } = await context.params;
    return jsonOk(await findProposal(workspaceId, id));
  } catch (error) {
    return jsonError(error);
  }
});

export const PATCH = measuredRoute("PATCH /api/proposals/:id", async (request: Request, context: RouteContext) => {
  try {
    const { workspaceId, userId } = await requirePermission("crm:write");
    await enforceRateLimit({ key: `mut:${workspaceId}:${userId}`, ...RATE_LIMITS.mutation });
    const { id } = await context.params;
    const existing = await findProposal(workspaceId, id);
    const body = emptyToNull(parseBody(proposalUpdateSchema, await request.json()));
    await assertRelationsInWorkspace(workspaceId, {
      leadId: body.leadId,
      opportunityId: body.opportunityId,
      linkedPropertyId: body.linkedPropertyId,
      ownerId: body.ownerId,
    });

    const now = new Date();
    const becomingSent = body.status === "SENT" && existing.status !== "SENT";
    const becomingViewed = body.status === "VIEWED";
    const firstViewed = becomingViewed && existing.status !== "VIEWED";
    const becomingAccepted = body.status === "ACCEPTED" && existing.status !== "ACCEPTED";

    const updated = await prisma.proposal.updateMany({
      where: { id, workspaceId, deletedAt: null },
      data: {
        ...body,
        ...(becomingSent ? { sentAt: existing.sentAt ?? now } : {}),
        ...(becomingViewed
          ? {
              viewedAt: existing.viewedAt ?? now,
              viewCount: { increment: 1 },
            }
          : {}),
      },
    });
    if (updated.count === 0) throw new ApiError(404, "Proposal not found");
    const proposal = await findProposal(workspaceId, id);

    if (becomingSent) {
      await writeAudit({
        workspaceId,
        actorId: userId,
        action: "PROPOSAL_SENT",
        entity: "Proposal",
        entityId: proposal.id,
      });

      await runAutomations({
        workspaceId,
        actorId: userId,
        trigger: "PROPOSAL_SENT",
        leadId: proposal.leadId,
        opportunityId: proposal.opportunityId,
        payload: {
          proposalId: proposal.id,
          proposalNumber: proposal.proposalNumber,
        },
      });
    } else if (becomingViewed) {
      await writeAudit({
        workspaceId,
        actorId: userId,
        action: "PROPOSAL_VIEWED",
        entity: "Proposal",
        entityId: proposal.id,
        metadata: { viewCount: proposal.viewCount, firstViewed },
      });

      await runAutomations({
        workspaceId,
        actorId: userId,
        trigger: "PROPOSAL_VIEWED",
        leadId: proposal.leadId,
        opportunityId: proposal.opportunityId,
        payload: { proposalId: proposal.id, proposalNumber: proposal.proposalNumber },
      });
    } else if (becomingAccepted) {
      await writeAudit({
        workspaceId,
        actorId: userId,
        action: "PROPOSAL_UPDATED",
        entity: "Proposal",
        entityId: proposal.id,
        metadata: {
          fields: ["status"],
          acceptedVia: "demo_simulation",
          demoNotice: "Simulated acceptance — not a real client e-signature.",
        },
      });
    } else {
      await writeAudit({
        workspaceId,
        actorId: userId,
        action: "PROPOSAL_UPDATED",
        entity: "Proposal",
        entityId: proposal.id,
        metadata: { fields: Object.keys(body) },
      });
    }

    return jsonOk({
      ...proposal,
      demo: becomingAccepted ? true : undefined,
      notice: becomingAccepted
        ? "Simulated acceptance recorded — not a real client e-signature."
        : undefined,
    });
  } catch (error) {
    return jsonError(error);
  }
});

export const DELETE = measuredRoute("DELETE /api/proposals/:id", async (_request: Request, context: RouteContext) => {
  try {
    const { workspaceId, userId } = await requirePermission("crm:delete");
    await enforceRateLimit({ key: `mut:${workspaceId}:${userId}`, ...RATE_LIMITS.mutation });
    const { id } = await context.params;
    await findProposal(workspaceId, id);

    const result = await prisma.proposal.updateMany({
      where: { id, workspaceId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (result.count === 0) throw new ApiError(404, "Proposal not found");
    const proposal = { id };

    await writeAudit({
      workspaceId,
      actorId: userId,
      action: "PROPOSAL_UPDATED",
      entity: "Proposal",
      entityId: proposal.id,
      metadata: { softDeleted: true },
    });

    return jsonOk({ ok: true, id: proposal.id });
  } catch (error) {
    return jsonError(error);
  }
});
