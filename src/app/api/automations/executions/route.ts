import { jsonError, jsonOk, requirePermission } from "@/lib/api";
import { prisma } from "@/lib/db";
import { measuredRoute } from "@/lib/perf";


export const GET = measuredRoute("GET /api/automations/executions", async (request: Request) => {
  try {
    const { workspaceId } = await requirePermission("automations:read");
    const url = new URL(request.url);
    const automationId = url.searchParams.get("automationId") ?? undefined;
    const status = url.searchParams.get("status") ?? undefined;

    const items = await prisma.automationExecution.findMany({
      where: {
        workspaceId,
        automationId,
        ...(status ? { status: status as never } : {}),
      },
      include: { automation: { select: { name: true, trigger: true } } },
      orderBy: { createdAt: "desc" },
      take: 80,
    });
    return jsonOk({ items });
  } catch (error) {
    return jsonError(error);
  }
});
