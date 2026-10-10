import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/log";
import { emailConfigured, sendEmail } from "@/lib/mail";
import { auditOutboundBlock, authorizeOutbound } from "@/lib/messaging/outbound-gate";

/**
 * The "instant automatic reply": one fixed, client-approved email to a new enquirer who gave an email address.
 * It goes through the outbound gate as a HUMAN-approved send (the template is agreed at onboarding, it is not AI
 * text), so an opt-out always wins. It is NOT recorded as first contact: an auto-reply is not a human answering the
 * question, and counting it would make every response time look instant.
 * ponytail: one fixed wording for every client; make it a per-workspace template when a client asks.
 */
export async function sendEnquiryAck(input: { workspaceId: string; leadId: string; email: string; firstName: string }) {
  if (!emailConfigured()) return;
  try {
    const decision = await authorizeOutbound({
      workspaceId: input.workspaceId,
      leadId: input.leadId,
      channel: "EMAIL",
      intent: "HUMAN",
      recipientAddress: input.email,
    });
    if (!decision.allowed) {
      await auditOutboundBlock({ workspaceId: input.workspaceId, leadId: input.leadId, intent: "HUMAN", channel: "EMAIL", reason: decision.reason, detail: decision.detail });
      return;
    }
    const workspace = await prisma.workspace.findUnique({
      where: { id: input.workspaceId },
      select: { name: true, branding: { select: { companyName: true, displayName: true } } },
    });
    const business = workspace?.branding?.companyName || workspace?.branding?.displayName || workspace?.name || "our team";
    const replyTo = process.env.ENQUIRY_REPLY_TO || undefined;
    const text = [
      `Hi ${input.firstName},`,
      "",
      `Thanks for getting in touch with ${business}. We have your enquiry and a member of the team will reply shortly.`,
      ...(replyTo ? ["", "If you want to add anything, just reply to this email."] : []),
      "",
      business,
    ].join("\n");
    const result = await sendEmail({ to: input.email, subject: `We got your enquiry: ${business}`, text, idempotencyKey: `ack:${input.leadId}`, replyTo });
    await prisma.activity.create({
      data: {
        workspaceId: input.workspaceId,
        leadId: input.leadId,
        // SYSTEM, not EMAIL: EMAIL activity counts as contact with the customer in the custody rules.
        type: "SYSTEM",
        title: result.ok ? "Instant reply emailed" : "Instant reply could not be sent",
        status: "COMPLETED",
        metadata: { automated: true, channel: "EMAIL", template: "enquiry_ack", ok: result.ok, ...(result.ok ? {} : { error: result.error }) },
      },
    });
  } catch (error) {
    logEvent("error", "enquiry_ack_failed", { workspaceId: input.workspaceId, leadId: input.leadId, error });
  }
}
