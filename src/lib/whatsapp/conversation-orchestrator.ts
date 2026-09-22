import type { WhatsAppMessage } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { filterAndScoreProperties } from "@/lib/matching/properties";
import { getWhatsAppProvider } from "@/lib/providers/whatsapp";
import { getAIProvider } from "@/lib/ai/provider";
import { applyRequirementUpdate, type RequirementSnapshot } from "./extract-requirement";
import { triggerHandoff } from "./handoff-event";
import {
  assistWithAI,
  classifyIntent,
  decideConversationAction,
  detectReplyLanguage,
  extractRequirement,
  generateReply,
  type ConversationDecision,
} from "./conversation-intelligence";

/**
 * Marker written onto the Activity created by POST /leads/:id/take-over
 * (see src/app/api/leads/[id]/take-over/route.ts). Its presence for a lead
 * means a human has explicitly claimed the conversation — the automatic
 * conversational engine must never send another reply after that
 * (AGENTS spec section 25). Extraction and handoff detection keep running;
 * only the auto-reply is suppressed.
 */
async function hasHumanTakenOver(workspaceId: string, leadId: string): Promise<boolean> {
  const marker = await prisma.activity.findFirst({
    where: { workspaceId, leadId, metadata: { path: ["conversationTakeover"], equals: true } },
    select: { id: true },
  });
  return marker != null;
}

function readDecisionTag(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>).decision;
  return typeof value === "string" ? value : null;
}

/** Bounded recent-message window (AGENTS spec section 24) — language style is read from this, not the entire lifetime conversation. */
const RECENT_INBOUND_WINDOW = 10;

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
}): Promise<{ decision: ConversationDecision; sent: WhatsAppMessage } | null> {
  if (await hasHumanTakenOver(input.workspaceId, input.leadId)) return null;

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

  // Roman Urdu vs English is read from the recent inbound window, not just
  // this one message — a bare "rent" or "han" reply carries no language
  // signal on its own but should still match the style the customer has
  // been using (AGENTS spec section 10, 24).
  const recentInbound = await prisma.whatsAppMessage.findMany({
    where: { workspaceId: input.workspaceId, conversationId: input.conversationId, direction: "INBOUND" },
    orderBy: { sentAt: "desc" },
    take: RECENT_INBOUND_WINDOW,
    select: { body: true },
  });
  const lang = detectReplyLanguage(recentInbound.map((m) => m.body).join(" ") || input.message);
  const body = generateReply(decision, lang);

  const provider = getWhatsAppProvider();
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

  return { decision, sent };
}
