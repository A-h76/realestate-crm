import type { WhatsAppMessage } from "@prisma/client";
import { prisma } from "@/lib/db";
import type {
  WhatsAppDraftInput,
  WhatsAppProvider,
  WhatsAppSendInput,
} from "./types";

/**
 * WhatsApp Business Cloud API provider.
 * Persists CRM message events. Live Graph API sends only run when an access
 * token and phone number id are present; otherwise the message is stored as
 * QUEUED / FAILED and never pretended to have been delivered.
 */
export class WhatsAppBusinessProvider implements WhatsAppProvider {
  readonly name = "whatsapp-business";
  readonly isDemo = false;

  private configured() {
    return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
  }

  async sendMessage(workspaceId: string, input: WhatsAppSendInput): Promise<WhatsAppMessage> {
    const ready = this.configured();
    return prisma.whatsAppMessage.create({
      data: {
        workspaceId,
        conversationId: input.conversationId,
        direction: "OUTBOUND",
        body: input.body,
        status: ready ? "QUEUED" : "FAILED",
        leadId: input.leadId,
        opportunityId: input.opportunityId,
        senderId: input.senderId,
        provider: "whatsapp-business",
        metadata: {
          notice: ready
            ? "Queued for WhatsApp Business Cloud API."
            : "WhatsApp Business credentials incomplete. Message stored in CRM but not sent.",
        },
      },
    });
  }

  async draftMessage(workspaceId: string, input: WhatsAppDraftInput): Promise<WhatsAppMessage> {
    return prisma.whatsAppMessage.create({
      data: {
        workspaceId,
        conversationId: input.conversationId,
        direction: "OUTBOUND",
        body: input.body,
        status: "DRAFT",
        leadId: input.leadId,
        opportunityId: input.opportunityId,
        senderId: input.senderId,
        provider: "whatsapp-business",
        metadata: { notice: "Draft stored. Not sent." },
      },
    });
  }

  async listMessages(workspaceId: string, conversationId: string): Promise<WhatsAppMessage[]> {
    return prisma.whatsAppMessage.findMany({
      where: { workspaceId, conversationId },
      orderBy: { sentAt: "asc" },
    });
  }

  async getThread(workspaceId: string, conversationId: string) {
    const messages = await this.listMessages(workspaceId, conversationId);
    return {
      conversationId,
      messages,
      provider: this.name,
      isDemo: false,
    };
  }
}
