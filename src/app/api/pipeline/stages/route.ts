import { jsonError, jsonOk, requirePermission } from "@/lib/api";
import { prisma } from "@/lib/db";
import { measuredRoute } from "@/lib/perf";


export const GET = measuredRoute("GET /api/pipeline/stages", async (_request: Request) => {
  try {
    const { workspaceId } = await requirePermission("crm:read");
    const stages = await prisma.pipelineStage.findMany({
      where: { workspaceId, active: true },
      orderBy: { order: "asc" },
    });
    return jsonOk({ items: stages });
  } catch (error) {
    return jsonError(error);
  }
});
