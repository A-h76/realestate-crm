import { jsonError, jsonOk, requirePermission } from "@/lib/api";
import { pipelineAging, resolveReportRange, workspaceInsights } from "@/lib/insights";
import { measureExecution, measuredRoute } from "@/lib/perf";

export const GET = measuredRoute("GET /api/insights", async (request) => {
  try {
    const { workspaceId } = await requirePermission("crm:read");
    const url = new URL(request.url);
    const preset = url.searchParams.get("range") ?? "30d";
    const range = resolveReportRange(preset, url.searchParams.get("from"), url.searchParams.get("to"));
    const [insights, aging] = await Promise.all([
      measureExecution("insights.workspace", () => workspaceInsights(workspaceId, range)),
      measureExecution("insights.pipelineAging", () => pipelineAging(workspaceId)),
    ]);
    return jsonOk({ insights, aging, range: preset });
  } catch (error) {
    return jsonError(error);
  }
});
