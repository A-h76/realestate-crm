import { z } from "zod";
import { optionalId } from "./common";

export const whatsappSendSchema = z.object({
  conversationId: z.string().trim().min(1),
  body: z.string().trim().min(1),
  leadId: optionalId,
  opportunityId: optionalId,
});

export const whatsappDraftSchema = whatsappSendSchema;

export const whatsappSimulateInboundSchema = z.object({
  conversationId: z.string().trim().min(1),
  body: z.string().trim().min(1),
  leadId: optionalId,
  opportunityId: optionalId,
});

export type WhatsAppSendInput = z.infer<typeof whatsappSendSchema>;
export type WhatsAppDraftInput = z.infer<typeof whatsappDraftSchema>;
