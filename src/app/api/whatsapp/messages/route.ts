import { jsonError, jsonOk, requirePermission } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { getWhatsAppProvider } from "@/lib/providers/whatsapp";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { assertRelationsInWorkspace, touchLeadActivity } from "@/lib/tenant";
import { parseBody } from "@/lib/validations/common";
import { whatsappSendSchema } from "@/lib/validations/whatsapp";
import { measuredRoute } from "@/lib/perf";
import { auditOutboundBlock, authorizeOutbound, lockConversationControl } from "@/lib/messaging/outbound-gate";
import { ApiError } from "@/lib/errors";


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

    // Server-side authorization for a human-composed send: a revoked (opted-out) recipient is
    // refused here regardless of what the UI allowed. `HUMAN` intent does not require a
    // recorded opt-in — an agent answering a conversation the customer started is not
    // marketing — but it is still blocked by an opt-out. Held under the conversation-control
    // lock for consistency with the AI path.
    const recipient = body.leadId
      ? (await prisma.lead.findFirst({
          where: { id: body.leadId, workspaceId },
          select: { whatsappNumber: true, phone: true },
        }))
      : null;

    if (body.leadId) {
      const authorization = await prisma.$transaction(async (tx) => {
        await lockConversationControl(tx, workspaceId, body.leadId!);
        return authorizeOutbound({
          workspaceId,
          leadId: body.leadId!,
          channel: "WHATSAPP",
          intent: "HUMAN",
          recipientAddress: recipient?.whatsappNumber ?? recipient?.phone,
        });
      });
      if (!authorization.allowed) {
        await auditOutboundBlock({
          workspaceId,
          leadId: body.leadId,
          intent: "HUMAN",
          channel: "WHATSAPP",
          reason: authorization.reason,
          actorId: userId,
        });
        throw new ApiError(409, authorization.message, undefined, { blockedReason: authorization.reason });
      }
    }

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
        status: message.status === "FAILED" ? "CANCELLED" : "COMPLETED",
        title: message.status === "FAILED" ? "WhatsApp message not delivered" : "WhatsApp message logged",
        notes: body.body,
        metadata: {
          messageId: message.id,
          direction: "OUTBOUND",
          demo: provider.isDemo,
          failed: message.status === "FAILED",
        },
      },
    });

    await writeAudit({
      workspaceId,
      actorId: userId,
      action: "WHATSAPP_MESSAGE_LOGGED",
      entity: "WhatsAppMessage",
      entityId: message.id,
      metadata: { direction: "OUTBOUND", demo: provider.isDemo, failed: message.status === "FAILED" },
    });

    if (body.leadId) {
      await touchLeadActivity(workspaceId, body.leadId);
    }

    const deliveryUnknown = (message.metadata as { deliveryUnknown?: boolean } | null)?.deliveryUnknown === true;
    return jsonOk({
      message,
      demo: provider.isDemo,
      notice: provider.isDemo
        ? "Demo WhatsApp message generated. No real WhatsApp message was sent."
        : message.status === "SENT"
          ? "WhatsApp message sent."
          : deliveryUnknown
            ? "Delivery could not be confirmed. WhatsApp may have received it; check the customer's chat before sending again."
            : "Message stored in CRM. It was not delivered to WhatsApp.",
    }, 201);
  } catch (error) {
    return jsonError(error);
  }
});
