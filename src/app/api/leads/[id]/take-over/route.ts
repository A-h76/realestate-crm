import { ApiError, jsonError, jsonOk, requirePermission } from "@/lib/api";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { takeOverLead } from "@/lib/leads/take-over";
import { measuredRoute } from "@/lib/perf";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = measuredRoute(
  "POST /api/leads/:id/take-over",
  async (_request: Request, context: RouteContext) => {
    try {
      const { workspaceId, userId } = await requirePermission("crm:write");
      await enforceRateLimit({ key: `mut:${workspaceId}:${userId}`, ...RATE_LIMITS.mutation });
      const { id } = await context.params;

      const result = await takeOverLead(workspaceId, id, userId);
      if (!result) throw new ApiError(404, "Lead not found");

      return jsonOk(result);
    } catch (error) {
      return jsonError(error);
    }
  },
);
