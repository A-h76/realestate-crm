import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { listConversations } from "@/lib/whatsapp/inbox";
import { buildCrmEvents, parseHandoffTask } from "@/lib/whatsapp/inbox-list";
import { loadLeadContext } from "@/lib/ai/context";
import { filterAndScoreProperties } from "@/lib/matching/properties";
import { computeNextBestAction } from "@/lib/automation/next-best-action";
import { ConversationList } from "@/components/whatsapp/conversation-list";
import { LeadContextPanel } from "@/components/whatsapp/lead-context-panel";
import { HandoffBanner } from "@/components/whatsapp/handoff-banner";
import { MobileContextDrawer } from "@/components/whatsapp/mobile-context-drawer";
import { WhatsAppThread } from "@/components/whatsapp/whatsapp-thread";
import { OPEN_TASK_STATUSES } from "@/lib/whatsapp/handoff-event";
import { cn } from "@/lib/utils";

export default async function WhatsAppInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ lead?: string }>;
}) {
  const session = await auth();
  if (!session?.user) return null;
  const workspaceId = session.user.workspaceId;
  const currentUserId = session.user.id;

  const { lead: leadParam } = await searchParams;
  const conversations = await listConversations(workspaceId);
  const selectedLeadId = leadParam ?? conversations[0]?.lead.id ?? null;
  // On mobile, only an explicit tap (a ?lead= in the URL) should collapse the
  // list into the thread — the desktop-only default-select-first-conversation
  // convenience shouldn't skip straight past the list on a phone.
  const explicitlySelected = Boolean(leadParam);

  const ctx = selectedLeadId ? await loadLeadContext(workspaceId, selectedLeadId) : null;

  let matches: ReturnType<typeof filterAndScoreProperties> = [];
  let nba: ReturnType<typeof computeNextBestAction> | null = null;
  let crmEvents: ReturnType<typeof buildCrmEvents> = [];

  if (ctx) {
    matches = filterAndScoreProperties(ctx.lead, ctx.properties);
    nba = computeNextBestAction(ctx);

    const requirementUpdates = await prisma.auditLog.findMany({
      where: {
        workspaceId,
        entity: "Lead",
        entityId: ctx.lead.id,
        action: "LEAD_UPDATED",
        metadata: { path: ["source"], equals: "whatsapp_extraction" },
      },
      orderBy: { createdAt: "asc" },
      take: 20,
      select: { id: true, createdAt: true, metadata: true },
    });
    crmEvents = buildCrmEvents(ctx.activities, requirementUpdates);
  }

  const openHandoffTask = ctx
    ? ctx.tasks.find(
        (t) =>
          (OPEN_TASK_STATUSES as readonly string[]).includes(t.status) &&
          Boolean(t.description?.includes("[handoff:")),
      )
    : undefined;
  const parsedHandoff = openHandoffTask ? parseHandoffTask(openHandoffTask) : null;

  const conversationId = ctx ? `lead:${ctx.lead.id}` : null;

  const panel = ctx ? <LeadContextPanel lead={ctx.lead} matches={matches} nba={nba} handoff={parsedHandoff} /> : null;

  return (
    <div className="page-in flex h-full flex-col">
      <PageHeader
        eyebrow="WhatsApp"
        title="Inbox"
        description="Who needs your attention right now — grounded in the real conversation, requirement, and handoff state."
        className="shrink-0 px-6 pt-6 md:px-8"
      />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className={cn(
            "w-full shrink-0 border-r border-border md:w-[320px]",
            explicitlySelected ? "hidden md:block" : "block",
          )}
        >
          <ConversationList conversations={conversations} selectedLeadId={selectedLeadId} currentUserId={currentUserId} />
        </div>

        <div className={cn("flex min-w-0 flex-1 flex-col", explicitlySelected ? "flex" : "hidden md:flex")}>
          {ctx && conversationId ? (
            <>
              <Link href="/whatsapp" className="shrink-0 border-b border-border px-4 py-2 text-[12px] text-muted hover:text-foreground md:hidden">
                ← Conversations
              </Link>
              {parsedHandoff ? (
                <HandoffBanner
                  handoff={parsedHandoff}
                  leadId={ctx.lead.id}
                  ownerName={ctx.lead.owner?.name ?? null}
                  isMine={ctx.lead.ownerId === currentUserId}
                />
              ) : null}
              {panel ? <MobileContextDrawer>{panel}</MobileContextDrawer> : null}
              <div className="min-h-0 flex-1">
                <WhatsAppThread leadId={ctx.lead.id} conversationId={conversationId} crmEvents={crmEvents} fill />
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted">
              {conversations.length === 0
                ? "No WhatsApp conversations logged yet."
                : "Select a conversation to see the thread."}
            </div>
          )}
        </div>

        {panel ? (
          <div className="hidden w-[340px] shrink-0 overflow-y-auto border-l border-border xl:block">{panel}</div>
        ) : null}
      </div>
    </div>
  );
}
