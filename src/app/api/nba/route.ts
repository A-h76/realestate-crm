import { ApiError, jsonError, jsonOk, requirePermission } from "@/lib/api";
import { nextBestActionForLead } from "@/lib/automation/next-best-action";
import { measuredRoute } from "@/lib/perf";


export const GET = measuredRoute("GET /api/nba", async (request: Request) => {
  try {
    const { workspaceId } = await requirePermission("crm:read");
    const leadId = new URL(request.url).searchParams.get("leadId");
    if (!leadId) throw new ApiError(400, "leadId is required");
    const action = await nextBestActionForLead(workspaceId, leadId);
    if (!action) throw new ApiError(404, "Lead not found");
    return jsonOk({ action });
  } catch (error) {
    return jsonError(error);
  }
});
