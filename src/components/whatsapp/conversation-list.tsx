"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatDateTimePK } from "@/lib/format";
import { cn } from "@/lib/utils";
import { matchesInboxFilter, type ConversationListItem, type InboxFilter } from "@/lib/whatsapp/inbox-list";

const FILTERS: Array<{ value: InboxFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "needs_attention", label: "Needs attention" },
  { value: "handoff", label: "Human handoff" },
  { value: "mine", label: "My leads" },
];

export function ConversationList({
  conversations,
  selectedLeadId,
  currentUserId,
}: {
  conversations: ConversationListItem[];
  selectedLeadId: string | null;
  currentUserId: string;
}) {
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [q, setQ] = useState("");

  const visible = useMemo(() => {
    const query = q.trim().toLowerCase();
    return conversations.filter((item) => {
      if (!matchesInboxFilter(item, filter, currentUserId)) return false;
      if (!query) return true;
      return (
        item.lead.name.toLowerCase().includes(query) ||
        (item.lead.phone ?? "").toLowerCase().includes(query)
      );
    });
  }, [conversations, filter, q, currentUserId]);

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-2 border-b border-border p-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name or phone…"
          className="h-9 w-full border border-border bg-background px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className="range-chip"
              data-active={filter === f.value ? "true" : "false"}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
        {visible.length === 0 ? (
          <p className="p-6 text-sm text-muted">No conversations match this view.</p>
        ) : (
          visible.map((item) => {
            const active = item.lead.id === selectedLeadId;
            return (
              <Link
                key={item.conversationId}
                href={`/whatsapp?lead=${item.lead.id}`}
                className={cn("block px-4 py-3 hover:bg-background", active && "bg-accent-soft")}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold">{item.lead.name}</span>
                  <span className="shrink-0 text-[11px] text-muted">
                    {item.lastMessage ? formatDateTimePK(item.lastMessage.at) : ""}
                  </span>
                </div>
                {item.lead.phone ? <div className="mono text-[11px] text-muted">{item.lead.phone}</div> : null}
                {item.lastMessage ? (
                  <p className="mt-1 line-clamp-1 text-[13px] text-muted">
                    {item.lastMessage.direction === "OUTBOUND" ? "You: " : ""}
                    {item.lastMessage.body}
                  </p>
                ) : null}
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {item.handoff?.status === "TODO" ? <Badge tone="danger">Human handoff</Badge> : null}
                  {item.handoff?.status === "IN_PROGRESS" ? <Badge tone="warning">Handoff in progress</Badge> : null}
                  {!item.handoff && item.needsReply ? <Badge tone="warning">Needs reply</Badge> : null}
                  {item.lead.ownerName ? <Badge tone="neutral">{item.lead.ownerName}</Badge> : null}
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
