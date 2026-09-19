import { jsonError, jsonOk, requirePermission } from "@/lib/api";
import { getWhatsAppProvider } from "@/lib/providers/whatsapp";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { assertRelationsInWorkspace } from "@/lib/tenant";
import { parseBody } from "@/lib/validations/common";
import { whatsappDraftSchema } from "@/lib/validations/whatsapp";
import { measuredRoute } from "@/lib/perf";


export const POST = measuredRoute("POST /api/whatsapp/draft", async (request: Request) => {
  try {
    const { workspaceId, userId } = await requirePermission("whatsapp:send");
    await enforceRateLimit({ key: `wa-draft:${workspaceId}:${userId}`, ...RATE_LIMITS.whatsappSend });
    const body = parseBody(whatsappDraftSchema, await request.json());
    await assertRelationsInWorkspace(workspaceId, {
      leadId: body.leadId,
      opportunityId: body.opportunityId,
    });
    const provider = getWhatsAppProvider();

    const message = await provider.draftMessage(workspaceId, {
      conversationId: body.conversationId,
      body: body.body,
      leadId: body.leadId,
      opportunityId: body.opportunityId,
      senderId: userId,
    });

    return jsonOk({
      message,
      demo: provider.isDemo,
      notice: "Demo WhatsApp draft saved. Not sent to any recipient.",
    }, 201);
  } catch (error) {
    return jsonError(error);
  }
});
