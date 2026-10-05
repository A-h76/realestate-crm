import { randomUUID } from "node:crypto";
import { ApiError, jsonError, jsonOk, requirePermission } from "@/lib/api";
import { prisma } from "@/lib/db";
import { canonicalPhone } from "@/lib/phone";
import { assertDemoMode } from "@/lib/demo-mode";
import { whatsappStatus } from "@/lib/providers/whatsapp";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { assertRelationsInWorkspace } from "@/lib/tenant";
import { parseBody } from "@/lib/validations/common";
import { whatsappSimulateInboundSchema } from "@/lib/validations/whatsapp";
import { storeInboundMessage } from "@/lib/webhooks/whatsapp";
import { measuredRoute } from "@/lib/perf";

/**
 * Demo-only. Pretends the customer on a lead's WhatsApp number sent `body`, then runs the REAL inbound pipeline
 * (storeInboundMessage: lead match, requirement extraction, handoff detection, conversation turn), so the demo shows
 * what a Meta webhook delivery would do. It is not the webhook: no signature is involved, it is only reachable by a
 * signed-in user with whatsapp:send in Demo Mode, and it refuses to run unless the active provider is the demo one,
 * because the pipeline may send an automatic reply and that must never reach a real customer.
 */
export const POST = measuredRoute("POST /api/whatsapp/simulate-inbound", async (request: Request) => {
  try {
    assertDemoMode("Inbound simulation is only available in Demo Mode.");
    const { workspaceId, userId } = await requirePermission("whatsapp:send");
    await enforceRateLimit({ key: `wa-sim:${workspaceId}:${userId}`, ...RATE_LIMITS.whatsappSend });
    if (whatsappStatus().mode !== "demo") {
      throw new ApiError(400, "Inbound simulation is disabled while a live WhatsApp provider is selected.");
    }

    const body = parseBody(whatsappSimulateInboundSchema, await request.json());
    await assertRelationsInWorkspace(workspaceId, { leadId: body.leadId, opportunityId: body.opportunityId });

    let leadId = body.leadId ?? null;
    if (!leadId && body.opportunityId) {
      leadId = (await prisma.opportunity.findFirst({ where: { id: body.opportunityId, workspaceId }, select: { leadId: true } }))?.leadId ?? null;
    }
    const lead = leadId
      ? await prisma.lead.findFirst({ where: { id: leadId, workspaceId, deletedAt: null }, select: { whatsappNumber: true, phone: true, firstName: true, lastName: true } })
      : null;
    const rawPhone = lead?.whatsappNumber ?? lead?.phone ?? null;
    const phone = canonicalPhone(rawPhone);
    if (!lead || !phone) {
      throw new ApiError(400, "Simulation needs a lead with a phone number.");
    }

    const externalId = `sim-${randomUUID()}`;
    await storeInboundMessage({
      workspaceId,
      phone,
      body: body.body,
      externalId,
      profileName: [lead.firstName, lead.lastName].filter(Boolean).join(" ") || null,
      extractable: true,
      simulation: { actorId: userId },
    });
    const message = await prisma.whatsAppMessage.findFirstOrThrow({ where: { workspaceId, externalId } });

    return jsonOk(
      {
        message,
        demo: true,
        simulated: true,
        notice: "Simulated inbound message processed by the real inbound pipeline. Nothing was received from WhatsApp.",
      },
      201,
    );
  } catch (error) {
    return jsonError(error);
  }
});
