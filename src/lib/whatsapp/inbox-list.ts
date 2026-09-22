import { HANDOFF_REASON_LABELS, type HandoffReason } from "./detect-handoff";

/**
 * Pure inbox-list logic: no Prisma import here, so this module is safe to
 * import from both server code (src/lib/whatsapp/inbox.ts) and client
 * components (ConversationList, WhatsAppThread) without bundling the DB client.
 */

export type ConversationListItem = {
  conversationId: string;
  lead: {
    id: string;
    name: string;
    phone: string | null;
    stage: string;
    ownerId: string | null;
    ownerName: string | null;
  };
  lastMessage: { body: string; direction: "INBOUND" | "OUTBOUND" | "SYSTEM"; at: string } | null;
  handoff: ParsedHandoff | null;
  needsReply: boolean;
};

export type ParsedHandoff = {
  taskId: string;
  reasonCode: string;
  reasonLabel: string;
  actionLabel: string | null;
  /** The customer message that triggered the handoff, so the agent doesn't have to ask again. */
  triggerMessage: string | null;
  priority: string;
  /** TODO = still needs an agent to claim it. IN_PROGRESS = already claimed via "Take over". */
  status: "TODO" | "IN_PROGRESS";
};

export type InboxFilter = "all" | "needs_attention" | "handoff" | "mine";

export type CrmEvent = {
  id: string;
  at: string;
  title: string;
  detail: string | null;
};

/**
 * Groups the first (i.e. most recent, given callers order by sentAt desc)
 * message per conversationId. Kept generic/pure so it's unit-testable
 * without a database.
 */
export function dedupeLatestPerConversation<T extends { conversationId: string }>(
  messagesDescByTime: T[],
): Map<string, T> {
  const latest = new Map<string, T>();
  for (const message of messagesDescByTime) {
    if (!latest.has(message.conversationId)) {
      latest.set(message.conversationId, message);
    }
  }
  return latest;
}

const HANDOFF_TAG_RE = /\[handoff:([A-Z_]+)\]/;
const REASON_LINE_RE = /^Reason: (.+)$/m;
const ACTION_LINE_RE = /^Suggested Action: (.+)$/m;
const TRIGGER_LINE_RE = /^Last Customer Message: "(.*)"$/m;

/**
 * Extracts the handoff reason/suggested-action back out of a Task created by
 * triggerHandoff() (src/lib/whatsapp/handoff-event.ts). The task carries no
 * structured metadata field (Task has none), so this parses the fixed-format
 * description that function writes. Never throws — a task with no handoff
 * tag, or a description missing the optional lines, simply yields less detail.
 */
export function parseHandoffTask(
  task: { id: string; description: string | null; priority: string; status: string } | null | undefined,
): ParsedHandoff | null {
  if (!task?.description) return null;
  const tagMatch = task.description.match(HANDOFF_TAG_RE);
  if (!tagMatch) return null;
  const reasonCode = tagMatch[1] as HandoffReason;
  const reasonLabel =
    task.description.match(REASON_LINE_RE)?.[1]?.trim() ?? HANDOFF_REASON_LABELS[reasonCode] ?? reasonCode;
  const actionLabel = task.description.match(ACTION_LINE_RE)?.[1]?.trim() ?? null;
  const triggerMessage = task.description.match(TRIGGER_LINE_RE)?.[1]?.trim() ?? null;
  const status = task.status === "IN_PROGRESS" ? "IN_PROGRESS" : "TODO";
  return { taskId: task.id, reasonCode, reasonLabel, actionLabel, triggerMessage, priority: task.priority, status };
}

export function matchesInboxFilter(
  item: ConversationListItem,
  filter: InboxFilter,
  currentUserId: string | null,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "needs_attention":
      return item.needsReply || item.handoff != null;
    case "handoff":
      return item.handoff != null;
    case "mine":
      return currentUserId != null && item.lead.ownerId === currentUserId;
    default:
      return true;
  }
}

const REQUIREMENT_FIELD_LABELS: Record<string, string> = {
  propertyPurpose: "Purpose",
  propertyTypePref: "Property type",
  intentType: "Intent",
  preferredArea: "Area",
  budgetMin: "Budget min",
  budgetMax: "Budget max",
  sizePrefMin: "Size min",
  sizePrefMax: "Size max",
  sizeUnitPref: "Size unit",
  bedroomPref: "Bedrooms",
};

export function summarizeRequirementFields(fields: string[]): string {
  return fields.map((f) => REQUIREMENT_FIELD_LABELS[f] ?? f).join(", ");
}

/** Defensive read of AuditLog.metadata.fields (Json, shape not guaranteed at runtime). */
export function extractAuditFields(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object") return [];
  const fields = (metadata as Record<string, unknown>).fields;
  if (!Array.isArray(fields)) return [];
  return fields.filter((f): f is string => typeof f === "string");
}

const SKIP_ACTIVITY_TYPES = new Set(["WHATSAPP_MESSAGE"]);

/**
 * Builds the "CRM EVENT" bubbles for the conversation thread from existing
 * Activity + AuditLog rows — never fabricated. WHATSAPP_MESSAGE-type
 * activities are skipped because they duplicate the real WhatsAppMessage
 * rows already rendered as chat bubbles.
 */
export function buildCrmEvents(
  activities: Array<{ id: string; type: string; title: string | null; notes: string | null; date: Date | string }>,
  requirementUpdates: Array<{ id: string; createdAt: Date | string; metadata: unknown }>,
): CrmEvent[] {
  const fromActivities: CrmEvent[] = activities
    .filter((a) => !SKIP_ACTIVITY_TYPES.has(a.type))
    .map((a) => ({
      id: `activity:${a.id}`,
      at: new Date(a.date).toISOString(),
      title: a.title ?? a.type.replaceAll("_", " "),
      detail: a.notes ?? null,
    }));

  const fromRequirementUpdates: CrmEvent[] = requirementUpdates.map((r) => {
    const fields = extractAuditFields(r.metadata);
    return {
      id: `requirement:${r.id}`,
      at: new Date(r.createdAt).toISOString(),
      title: "Requirement updated",
      detail: fields.length ? summarizeRequirementFields(fields) : null,
    };
  });

  return [...fromActivities, ...fromRequirementUpdates].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  );
}
