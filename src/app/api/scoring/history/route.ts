import { jsonError, jsonOk, requirePermission } from "@/lib/api";
import { prisma } from "@/lib/db";
import { measuredRoute } from "@/lib/perf";


export const GET = measuredRoute("GET /api/scoring/history", async (request: Request) => {
  try {
    const { workspaceId } = await requirePermission("crm:read");
    const leadId = new URL(request.url).searchParams.get("leadId");
    if (!leadId) return jsonOk({ items: [] });
    const items = await prisma.scoreHistory.findMany({
      where: { workspaceId, leadId },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return jsonOk({ items });
  } catch (error) {
    return jsonError(error);
  }
});
