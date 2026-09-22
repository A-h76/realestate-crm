import { prisma } from "@/lib/db";
import { OPEN_TASK_STATUSES } from "./handoff-event";
import { dedupeLatestPerConversation, parseHandoffTask, type ConversationListItem } from "./inbox-list";

/**
 * Recent-message window the conversation list is built from, per section 17
 * (recent-message window instead of loading the whole table). Conversations
 * with no message in this window simply don't surface — acceptable for an
 * inbox that's about "who needs my attention now".
 */
const RECENT_MESSAGE_WINDOW = 300;

export async function listConversations(workspaceId: string): Promise<ConversationListItem[]> {
  const recentMessages = await prisma.whatsAppMessage.findMany({
    where: { workspaceId },
    orderBy: { sentAt: "desc" },
    take: RECENT_MESSAGE_WINDOW,
    select: { conversationId: true, leadId: true, body: true, direction: true, sentAt: true },
  });

  const latestByConversation = dedupeLatestPerConversation(recentMessages);
  const leadIds = [
    ...new Set(
      [...latestByConversation.values()].map((m) => m.leadId).filter((id): id is string => Boolean(id)),
    ),
  ];
  if (leadIds.length === 0) return [];

  const [leads, handoffTasks] = await Promise.all([
    prisma.lead.findMany({
      where: { id: { in: leadIds }, workspaceId, deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        whatsappNumber: true,
        stage: true,
        ownerId: true,
        owner: { select: { name: true } },
      },
    }),
    prisma.task.findMany({
      where: {
        workspaceId,
        leadId: { in: leadIds },
        status: { in: [...OPEN_TASK_STATUSES] },
        description: { contains: "[handoff:" },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, leadId: true, description: true, priority: true, status: true },
    }),
  ]);

  const leadById = new Map(leads.map((l) => [l.id, l]));
  const handoffByLead = new Map<string, (typeof handoffTasks)[number]>();
  for (const task of handoffTasks) {
    if (task.leadId && !handoffByLead.has(task.leadId)) handoffByLead.set(task.leadId, task);
  }

  const items: ConversationListItem[] = [];
  for (const [conversationId, last] of latestByConversation) {
    if (!last.leadId) continue;
    const lead = leadById.get(last.leadId);
    if (!lead) continue; // deleted / cross-workspace lead — never surfaced

    items.push({
      conversationId,
      lead: {
        id: lead.id,
        name: `${lead.firstName} ${lead.lastName ?? ""}`.trim(),
        phone: lead.whatsappNumber ?? lead.phone,
        stage: lead.stage,
        ownerId: lead.ownerId,
        ownerName: lead.owner?.name ?? null,
      },
      lastMessage: { body: last.body, direction: last.direction, at: last.sentAt.toISOString() },
      handoff: parseHandoffTask(handoffByLead.get(lead.id)),
      needsReply: last.direction === "INBOUND",
    });
  }

  return items.sort((a, b) => {
    const at = a.lastMessage ? new Date(a.lastMessage.at).getTime() : 0;
    const bt = b.lastMessage ? new Date(b.lastMessage.at).getTime() : 0;
    return bt - at;
  });
}
