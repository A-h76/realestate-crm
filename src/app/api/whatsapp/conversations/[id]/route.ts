import { jsonError, jsonOk, requirePermission } from "@/lib/api";
import { getWhatsAppProvider } from "@/lib/providers/whatsapp";
import { measuredRoute } from "@/lib/perf";


type RouteContext = { params: Promise<{ id: string }> };

export const GET = measuredRoute("GET /api/whatsapp/conversations/:id", async (_request: Request, context: RouteContext) => {
  try {
    const { workspaceId } = await requirePermission("whatsapp:read");
    const { id } = await context.params;
    const provider = getWhatsAppProvider();
    const thread = await provider.getThread(workspaceId, decodeURIComponent(id));

    return jsonOk({
      ...thread,
      notice: provider.isDemo
        ? "Demo WhatsApp thread — messages are simulated locally."
        : undefined,
    });
  } catch (error) {
    return jsonError(error);
  }
});
