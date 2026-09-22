import type {
  WhatsAppDirection,
  WhatsAppMessage,
  WhatsAppMessageStatus,
} from "@prisma/client";

export type WhatsAppSendInput = {
  conversationId: string;
  body: string;
  leadId?: string | null;
  opportunityId?: string | null;
  senderId?: string | null;
  status?: WhatsAppMessageStatus;
  /** Merged into the stored message's metadata (e.g. tagging an automated conversational reply with its decision). */
  metadata?: Record<string, unknown> | null;
};

export type WhatsAppDraftInput = WhatsAppSendInput;

export interface WhatsAppProvider {
  readonly name: string;
  readonly isDemo: boolean;
  sendMessage(workspaceId: string, input: WhatsAppSendInput): Promise<WhatsAppMessage>;
  draftMessage(workspaceId: string, input: WhatsAppDraftInput): Promise<WhatsAppMessage>;
  listMessages(
    workspaceId: string,
    conversationId: string,
  ): Promise<WhatsAppMessage[]>;
  getThread(
    workspaceId: string,
    conversationId: string,
  ): Promise<{
    conversationId: string;
    messages: WhatsAppMessage[];
    provider: string;
    isDemo: boolean;
  }>;
  simulateInbound?(
    workspaceId: string,
    input: {
      conversationId: string;
      body: string;
      leadId?: string | null;
      opportunityId?: string | null;
    },
  ): Promise<WhatsAppMessage>;
}

export type { WhatsAppDirection, WhatsAppMessageStatus };
