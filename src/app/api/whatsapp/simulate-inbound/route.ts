import { ApiError, jsonError, jsonOk, requirePermission } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { notify } from "@/lib/notifications";
import { getWhatsAppProvider } from "@/lib/providers/whatsapp";
import { DemoWhatsAppProvider } from "@/lib/providers/whatsapp/demo";
import { assertDemoMode } from "@/lib/demo-mode";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { assertRelationsInWorkspace } from "@/lib/tenant";
import { parseBody } from "@/lib/validations/common";
import { whatsappSimulateInboundSchema } from "@/lib/validations/whatsapp";
import { measuredRoute } from "@/lib/perf";


export const POST = measuredRoute("POST /api/whatsapp/simulate-inbound", async (request: Request) => {
  try {
    assertDemoMode("Inbound simulation is only available in Demo Mode.");
    const { workspaceId, userId } = await requirePermission("whatsapp:send");
    await enforceRateLimit({ key: `wa-sim:${workspaceId}:${userId}`, ...RATE_LIMITS.whatsappSend });
    const provider = getWhatsAppProvider();

    if (!(provider instanceof DemoWhatsAppProvider) && !provider.isDemo) {
      throw new ApiError(400, "Inbound simulation is only available in Demo Mode.");
    }

    const body = parseBody(whatsappSimulateInboundSchema, await request.json());
    await assertRelationsInWorkspace(workspaceId, {
      leadId: body.leadId,
      opportunityId: body.opportunityId,
    });
    const demoProvider =
      provider instanceof DemoWhatsAppProvider ? provider : new DemoWhatsAppProvider();

    const message = await demoProvider.simulateInbound!(workspaceId, {
      conversationId: body.conversationId,
      body: body.body,
      leadId: body.leadId,
      opportunityId: body.opportunityId,
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
        title: "Simulated inbound WhatsApp",
        notes: "Simulated inbound Demo WhatsApp message.",
        metadata: { messageId: message.id, direction: "INBOUND", demo: true },
      },
    });

    await writeAudit({
      workspaceId,
      actorId: userId,
      action: "WHATSAPP_MESSAGE_LOGGED",
      entity: "WhatsAppMessage",
      entityId: message.id,
      metadata: { direction: "INBOUND", demo: true, simulated: true },
    });

    if (body.leadId) {
      const lead = await prisma.lead.findFirst({
        where: { id: body.leadId, workspaceId },
        select: { ownerId: true },
      });
      if (lead?.ownerId) {
        await notify({
          workspaceId,
          userId: lead.ownerId,
          type: "WHATSAPP_RECEIVED",
          title: "WhatsApp message received",
          body: "Simulated inbound WhatsApp message",
          href: `/leads/${body.leadId}`,
          entityType: "Lead",
          entityId: body.leadId,
        });
      }
    }

    return jsonOk({
      message,
      demo: true,
      notice: "Simulated inbound Demo WhatsApp message.",
    }, 201);
  } catch (error) {
    return jsonError(error);
  }
});
