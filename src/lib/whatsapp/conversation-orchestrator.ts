import type { WhatsAppMessage } from "@prisma/client";
import { prisma } from "@/lib/db";
import { notifyOnce } from "@/lib/notifications";
import { writeAudit } from "@/lib/audit";
import { filterAndScoreProperties } from "@/lib/matching/properties";
import { getWhatsAppProvider } from "@/lib/providers/whatsapp";
import { getAIProvider } from "@/lib/ai/provider";
import { applyRequirementUpdate, type RequirementSnapshot } from "./extract-requirement";
import { triggerHandoff } from "./handoff-event";
import { markFirstContact } from "@/lib/leads/custody";
import {
  DEFERRABLE_BLOCKS,
  auditOutboundBlock,
  authorizeOutbound,
  hasHumanTakenOver,
  lockConversationControl,
  type OutboundDecision,
} from "@/lib/messaging/outbound-gate";
import {
  assistWithAI,
  classifyIntent,
  decideConversationAction,
  extractRequirement,
  generateReply,
  type ConversationDecision,
} from "./conversation-intelligence";

function readDecisionTag(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>).decision;
  return typeof value === "string" ? value : null;
}

/**
 * Runs one turn of the conversational layer for a customer message that did
 * NOT trigger a P0 #2 handoff. Only ever called from an inbound customer
 * message — never from our own outbound sends or Meta delivery-status
 * callbacks (AGENTS spec section 23), and never sends when a human has
 * taken over (section 25).
 */
export async function runConversationTurn(input: {
  workspaceId: string;
  leadId: string;
  conversationId: string;
  messageId: string;
  message: string;
}): Promise<{
  decision: ConversationDecision;
  sent: WhatsAppMessage | null;
  draft?: WhatsAppMessage;
  blocked?: string;
} | null> {
  // Early exit: cheap and avoids doing the work at all. It is NOT the authorization check —
  // minutes of AI/DB work can pass before the send, so the binding check happens under the
  // conversation-control lock immediately before the provider call (US-36).
  if (await hasHumanTakenOver(prisma, input.workspaceId, input.leadId)) return null;

  const lead = await prisma.lead.findFirst({
    where: { id: input.leadId, workspaceId: input.workspaceId, deletedAt: null },
  });
  if (!lead) return null;

  const extracted = extractRequirement(input.message);
  let intent = classifyIntent(input.message, extracted);
  let freshLead = lead;

  if (intent === "UNKNOWN" && Object.keys(extracted).length === 0) {
    const provider = getAIProvider();
    if (provider) {
      const assisted = await assistWithAI(provider, input.message);
      if (assisted) {
        intent = assisted.intent;
        if (Object.keys(assisted.extracted).length > 0) {
          await applyRequirementUpdate(input.workspaceId, input.leadId, lead as unknown as RequirementSnapshot, assisted.extracted);
          // Fields may have just been filled — decide off the current row, not the stale one.
          freshLead = (await prisma.lead.findFirst({ where: { id: input.leadId, workspaceId: input.workspaceId } })) ?? lead;
        }
      }
    }
  }

  const properties = await prisma.property.findMany({
    where: { workspaceId: input.workspaceId, deletedAt: null },
    take: 80,
  });
  const matches = filterAndScoreProperties(freshLead, properties);

  const lastOutbound = await prisma.whatsAppMessage.findFirst({
    where: { workspaceId: input.workspaceId, conversationId: input.conversationId, direction: "OUTBOUND" },
    orderBy: { sentAt: "desc" },
    select: { metadata: true },
  });

  const decision = decideConversationAction({
    lead: freshLead,
    intent,
    matches,
    lastOutboundDecision: readDecisionTag(lastOutbound?.metadata),
  });

  if (decision.type === "HANDOFF") {
    await triggerHandoff({
      workspaceId: input.workspaceId,
      leadId: input.leadId,
      detection: {
        shouldHandoff: true,
        reason: decision.reason,
        confidence: decision.confidence,
        suggestedAction: decision.suggestedAction,
      },
      triggerMessage: input.message,
      triggerMessageId: input.messageId,
    });
  }

  const body = generateReply(decision);

  const provider = getWhatsAppProvider();
  const recipient = freshLead.whatsappNumber ?? freshLead.phone;

  // Authorization and the provider call are serialized against take-over on the same advisory
  // lock, so a human claiming this conversation mid-turn cannot be overtaken by this send.
  // The lock is held for the duration of the transaction only; the send itself is issued after
  // the decision is committed, which is why the decision is re-read here and not reused from
  // the top of the turn.
  const authorization = await prisma.$transaction(async (tx): Promise<OutboundDecision> => {
    await lockConversationControl(tx, input.workspaceId, input.leadId);
    return authorizeOutbound({
      workspaceId: input.workspaceId,
      leadId: input.leadId,
      channel: "WHATSAPP",
      intent: "AI",
      recipientAddress: recipient,
    });
  });

  if (!authorization.allowed) {
    await auditOutboundBlock({
      workspaceId: input.workspaceId,
      leadId: input.leadId,
      intent: "AI",
      channel: "WHATSAPP",
      reason: authorization.reason,
      detail: authorization.detail,
    });
    // A refused send is still worth keeping: in DRAFT mode (the default) the reply the
    // assistant would have sent is saved for a human to review, edit and send. A consent
    // block or a take-over produces no draft — there is nothing a human should send here.
    if (!DEFERRABLE_BLOCKS.includes(authorization.reason)) {
      return { decision, sent: null, blocked: authorization.reason };
    }
    const draft = await provider.draftMessage(input.workspaceId, {
      conversationId: input.conversationId,
      body,
      leadId: input.leadId,
      metadata: { auto: true, decision: decision.type, awaitingApproval: true },
    });
    await writeAudit({
      workspaceId: input.workspaceId,
      action: "WHATSAPP_MESSAGE_LOGGED",
      entity: "WhatsAppMessage",
      entityId: draft.id,
      metadata: { direction: "OUTBOUND", auto: true, decision: decision.type, status: "DRAFT" },
    });
    // DRAFT is the default mode: without this the owner never learns a reply is waiting and the first-response promise fails silently.
    if (lead.ownerId) {
      await notifyOnce({
        workspaceId: input.workspaceId,
        userId: lead.ownerId,
        type: "DRAFT_REPLY_WAITING",
        title: "AI reply waiting for your approval",
        body: "A customer wrote in and a drafted reply needs review before it is sent.",
        href: `/conversations?lead=${input.leadId}`,
        entityType: "Lead",
        entityId: input.leadId,
        dedupeKey: `draft-reply:${draft.id}`,
      });
    }
    return { decision, sent: null, draft, blocked: authorization.reason };
  }

  const sent = await provider.sendMessage(input.workspaceId, {
    conversationId: input.conversationId,
    body,
    leadId: input.leadId,
    metadata: { auto: true, decision: decision.type },
  });

  await writeAudit({
    workspaceId: input.workspaceId,
    action: "WHATSAPP_MESSAGE_LOGGED",
    entity: "WhatsAppMessage",
    entityId: sent.id,
    metadata: { direction: "OUTBOUND", auto: true, decision: decision.type },
  });

  if (sent.status !== "FAILED" && sent.status !== "DRAFT") {
    await markFirstContact({ workspaceId: input.workspaceId, leadId: input.leadId, at: sent.sentAt, actorType: "AI", via: "ai_reply" });
  }

  return { decision, sent };
}
