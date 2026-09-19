import { ApiError, jsonError, jsonOk, requirePermission } from "@/lib/api";
import { isDemoMode } from "@/lib/demo-mode";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { resetDemo } from "@/lib/demo/reset-demo";
import { measuredRoute } from "@/lib/perf";


export const POST = measuredRoute("POST /api/demo/reset", async (_request: Request) => {
  try {
    const { workspaceId, userId } = await requirePermission("demo:reset");
    await enforceRateLimit({ key: `demo-reset:${workspaceId}:${userId}`, ...RATE_LIMITS.demoReset });

    if (!isDemoMode()) {
      throw new ApiError(403, "Demo reset is only available in demo mode");
    }

    const result = await resetDemo(workspaceId, userId);

    return jsonOk({ ok: true, ...result, message: "Demo workspace reset." });
  } catch (error) {
    return jsonError(error);
  }
});
