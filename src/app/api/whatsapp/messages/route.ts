import { jsonError, jsonOk, requirePermission } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { getWhatsAppProvider } from "@/lib/providers/whatsapp";
import { DemoWhatsAppProvider } from "@/lib/providers/whatsapp/demo";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { assertRelationsInWorkspace, touchLeadActivity } from "@/lib/tenant";
import { parseBody } from "@/lib/validations/common";
import { whatsappSendSchema } from "@/lib/validations/whatsapp";
import { measuredRoute } from "@/lib/perf";


export const POST = measuredRoute("POST /api/whatsapp/messages", async (request: Request) => {
  try {
    const { workspaceId, userId } = await requirePermission("whatsapp:send");
    await enforceRateLimit({ key: `wa-send:${workspaceId}:${userId}`, ...RATE_LIMITS.whatsappSend });
    const body = parseBody(whatsappSendSchema, await request.json());
    await assertRelationsInWorkspace(workspaceId, {
      leadId: body.leadId,
      opportunityId: body.opportunityId,
    });
    const provider = getWhatsAppProvider();

    const message = await provider.sendMessage(workspaceId, {
      conversationId: body.conversationId,
      body: body.body,
      leadId: body.leadId,
      opportunityId: body.opportunityId,
      senderId: userId,
    });

    await prisma.activity.create({
      data: {
        workspaceId,
        type: "WHATSAPP_MESSAGE",
        leadId: body.leadId,
        opportunityId: body.opportunityId,
        ownerId: userId,
        date: message.sentAt,
        status: "COMPLETED",
        title: "WhatsApp message logged",
        notes: body.body,
        metadata: {
          messageId: message.id,
          direction: "OUTBOUND",
          demo: provider.isDemo,
        },
      },
    });

    await writeAudit({
      workspaceId,
      actorId: userId,
      action: "WHATSAPP_MESSAGE_LOGGED",
      entity: "WhatsAppMessage",
      entityId: message.id,
      metadata: { direction: "OUTBOUND", demo: provider.isDemo },
    });

    if (body.leadId) {
      await touchLeadActivity(workspaceId, body.leadId);
    }

    return jsonOk({
      message,
      demo: provider.isDemo,
      notice: provider.isDemo
        ? "Demo WhatsApp message generated. No real WhatsApp message was sent."
        : message.status === "SENT"
          ? "WhatsApp message sent."
          : "Message stored in CRM. It was not delivered to WhatsApp.",
    }, 201);
  } catch (error) {
    return jsonError(error);
  }
});

// keep DemoWhatsAppProvider referenced for type narrowing in simulate route
void DemoWhatsAppProvider;
