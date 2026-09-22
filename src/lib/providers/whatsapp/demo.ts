import type { WhatsAppMessage } from "@prisma/client";
import { prisma } from "@/lib/db";
import type {
  WhatsAppDraftInput,
  WhatsAppProvider,
  WhatsAppSendInput,
} from "./types";

export class DemoWhatsAppProvider implements WhatsAppProvider {
  readonly name = "demo";
  readonly isDemo = true;

  async sendMessage(workspaceId: string, input: WhatsAppSendInput): Promise<WhatsAppMessage> {
    return prisma.whatsAppMessage.create({
      data: {
        workspaceId,
        conversationId: input.conversationId,
        direction: "OUTBOUND",
        body: input.body,
        status: input.status ?? "SENT",
        leadId: input.leadId,
        opportunityId: input.opportunityId,
        senderId: input.senderId,
        provider: "demo",
        externalId: `demo-wa-${crypto.randomUUID()}`,
        metadata: {
          demoNotice: "Demo WhatsApp message generated. No real WhatsApp message was sent.",
          ...input.metadata,
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
        provider: "demo",
        metadata: {
          demoNotice: "Demo WhatsApp draft saved. Not sent to any recipient.",
        },
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
      isDemo: true,
    };
  }

  async simulateInbound(
    workspaceId: string,
    input: {
      conversationId: string;
      body: string;
      leadId?: string | null;
      opportunityId?: string | null;
    },
  ): Promise<WhatsAppMessage> {
    return prisma.whatsAppMessage.create({
      data: {
        workspaceId,
        conversationId: input.conversationId,
        direction: "INBOUND",
        body: input.body,
        status: "DELIVERED",
        leadId: input.leadId,
        opportunityId: input.opportunityId,
        provider: "demo",
        externalId: `demo-wa-in-${crypto.randomUUID()}`,
        metadata: {
          demoNotice: "Simulated inbound Demo WhatsApp message.",
        },
      },
    });
  }
}
