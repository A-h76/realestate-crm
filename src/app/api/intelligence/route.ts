import { z } from "zod";
import { ApiError, jsonError, jsonOk, requirePermission } from "@/lib/api";
import { prisma } from "@/lib/db";
import { analyzeLead } from "@/lib/ai/lead-analysis";
import { prepareCall } from "@/lib/ai/call-preparation";
import { prepareSiteVisit } from "@/lib/ai/site-visit-preparation";
import { draftFollowUp } from "@/lib/ai/follow-up-draft";
import { summarizeOpportunity } from "@/lib/ai/opportunity-summary";
import { analyzeLostDeal } from "@/lib/ai/lost-deal-analysis";
import { explainPropertyMatches } from "@/lib/ai/property-match";
import { summarizeProposal } from "@/lib/ai/proposal-summary";
import { parseBody } from "@/lib/validations/common";
import { runAutomations } from "@/lib/automation/engine";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { assertRelationsInWorkspace } from "@/lib/tenant";
import { measuredRoute } from "@/lib/perf";


const createSchema = z.object({
  kind: z.enum([
    "LEAD_ANALYSIS",
    "CALL_PREPARATION",
    "SITE_VISIT_PREPARATION",
    "FOLLOW_UP_DRAFT",
    "EMAIL_DRAFT",
    "LINKEDIN_DRAFT",
    "OPPORTUNITY_SUMMARY",
    "LOST_DEAL_ANALYSIS",
    "PROPERTY_MATCH",
    "PROPOSAL_SUMMARY",
  ]),
  leadId: z.string().optional(),
  opportunityId: z.string().optional(),
  proposalId: z.string().optional(),
  mixLanguage: z.boolean().optional(),
});

export const GET = measuredRoute("GET /api/intelligence", async (request: Request) => {
  try {
    const { workspaceId } = await requirePermission("intelligence:read");
    const url = new URL(request.url);
    const leadId = url.searchParams.get("leadId") ?? undefined;
    const opportunityId = url.searchParams.get("opportunityId") ?? undefined;
    const kind = url.searchParams.get("kind") ?? undefined;

    const items = await prisma.intelligenceRun.findMany({
      where: {
        workspaceId,
        leadId,
        opportunityId,
        ...(kind ? { kind: kind as never } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return jsonOk({ items });
  } catch (error) {
    return jsonError(error);
  }
});

export const POST = measuredRoute("POST /api/intelligence", async (request: Request) => {
  try {
    const { workspaceId, userId } = await requirePermission("intelligence:run");
    await enforceRateLimit({ key: `intel:${workspaceId}:${userId}`, ...RATE_LIMITS.intelligence });
    const body = parseBody(createSchema, await request.json());
    await assertRelationsInWorkspace(workspaceId, {
      leadId: body.leadId,
      opportunityId: body.opportunityId,
      proposalId: body.proposalId,
    });

    switch (body.kind) {
      case "LEAD_ANALYSIS": {
        if (!body.leadId) throw new ApiError(400, "leadId is required");
        const result = await analyzeLead({ workspaceId, leadId: body.leadId, actorId: userId });
        if (!result) throw new ApiError(404, "Lead not found");
        return jsonOk(result);
      }
      case "CALL_PREPARATION": {
        if (!body.leadId) throw new ApiError(400, "leadId is required");
        const result = await prepareCall({ workspaceId, leadId: body.leadId, actorId: userId });
        if (!result) throw new ApiError(404, "Lead not found");
        return jsonOk(result);
      }
      case "SITE_VISIT_PREPARATION": {
        if (!body.leadId) throw new ApiError(400, "leadId is required");
        const result = await prepareSiteVisit({ workspaceId, leadId: body.leadId, actorId: userId });
        if (!result) throw new ApiError(404, "Lead not found");
        return jsonOk(result);
      }
      case "FOLLOW_UP_DRAFT":
      case "EMAIL_DRAFT":
      case "LINKEDIN_DRAFT": {
        if (!body.leadId) throw new ApiError(400, "leadId is required");
        const channel =
          body.kind === "EMAIL_DRAFT" ? "EMAIL" : body.kind === "LINKEDIN_DRAFT" ? "LINKEDIN" : "WHATSAPP";
        const result = await draftFollowUp({
          workspaceId,
          leadId: body.leadId,
          actorId: userId,
          channel,
          mixLanguage: body.mixLanguage,
        });
        if (!result) throw new ApiError(404, "Lead not found");
        return jsonOk({ ...result, notice: "Draft only. Nothing was sent." });
      }
      case "OPPORTUNITY_SUMMARY": {
        if (!body.opportunityId) throw new ApiError(400, "opportunityId is required");
        const result = await summarizeOpportunity({
          workspaceId,
          opportunityId: body.opportunityId,
          actorId: userId,
        });
        if (!result) throw new ApiError(404, "Opportunity not found");
        return jsonOk(result);
      }
      case "LOST_DEAL_ANALYSIS": {
        if (!body.opportunityId) throw new ApiError(400, "opportunityId is required");
        const result = await analyzeLostDeal({
          workspaceId,
          opportunityId: body.opportunityId,
          actorId: userId,
        });
        if (!result) throw new ApiError(404, "Opportunity not found");
        return jsonOk(result);
      }
      case "PROPERTY_MATCH": {
        if (!body.leadId) throw new ApiError(400, "leadId is required");
        const result = await explainPropertyMatches({
          workspaceId,
          leadId: body.leadId,
          actorId: userId,
        });
        if (!result) throw new ApiError(404, "Lead not found");
        const best = result.scored[0];
        if (best && best.matchScore >= 80) {
          await runAutomations({
            workspaceId,
            actorId: userId,
            trigger: "STRONG_PROPERTY_MATCH",
            leadId: body.leadId,
            payload: { matchScore: best.matchScore },
          });
        }
        return jsonOk(result);
      }
      case "PROPOSAL_SUMMARY": {
        if (!body.proposalId) throw new ApiError(400, "proposalId is required");
        const result = await summarizeProposal({
          workspaceId,
          proposalId: body.proposalId,
          actorId: userId,
        });
        if (!result) throw new ApiError(404, "Proposal not found");
        return jsonOk(result);
      }
      default: {
        const _never: never = body.kind;
        return jsonOk({ error: `Unhandled kind ${_never}` }, 400);
      }
    }
  } catch (error) {
    return jsonError(error);
  }
});
