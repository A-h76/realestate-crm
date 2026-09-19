import { z } from "zod";
import { ApiError, jsonError, jsonOk, requirePermission } from "@/lib/api";
import { notify } from "@/lib/notifications";
import { parseBody } from "@/lib/validations/common";
import { scoreLead } from "@/lib/scoring/score-lead";
import { runAutomations } from "@/lib/automation/engine";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { measuredRoute } from "@/lib/perf";


const schema = z.object({
  leadId: z.string().min(1),
});

export const POST = measuredRoute("POST /api/scoring", async (request: Request) => {
  try {
    const { workspaceId, userId } = await requirePermission("scoring:run");
    await enforceRateLimit({ key: `score:${workspaceId}:${userId}`, ...RATE_LIMITS.scoring });
    const body = parseBody(schema, await request.json());
    const result = await scoreLead({ workspaceId, leadId: body.leadId, actorId: userId });
    if (!result) throw new ApiError(404, "Lead not found");

    if (result.lead.leadScore >= 80) {
      await runAutomations({
        workspaceId,
        actorId: userId,
        trigger: "LEAD_SCORED_HIGH",
        leadId: body.leadId,
        payload: { leadScore: result.lead.leadScore },
      });
    }
    if (result.lead.leadScore > result.previousScore && result.lead.ownerId) {
      await notify({
        workspaceId,
        userId: result.lead.ownerId,
        type: "LEAD_SCORE_INCREASED",
        title: `Lead score ${result.previousScore} → ${result.lead.leadScore}`,
        body: result.history.reason,
        href: `/leads/${body.leadId}`,
        entityType: "Lead",
        entityId: body.leadId,
      });
    }

    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
});
