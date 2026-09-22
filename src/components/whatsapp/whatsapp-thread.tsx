"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTimePK, formatTimePK } from "@/lib/format";
import type { CrmEvent } from "@/lib/whatsapp/inbox-list";
import { cn } from "@/lib/utils";

type WhatsAppMessage = {
  id: string;
  direction: "INBOUND" | "OUTBOUND" | "SYSTEM";
  body: string;
  status: string;
  sentAt: string;
  sender?: { name?: string | null } | null;
};

type TimelineItem =
  | { kind: "message"; at: string; message: WhatsAppMessage }
  | { kind: "crm"; at: string; event: CrmEvent };

export function WhatsAppThread({
  leadId,
  conversationId,
  crmEvents = [],
  fill = false,
}: {
  leadId: string;
  conversationId: string;
  crmEvents?: CrmEvent[];
  /** Fill the parent's height (used by the Inbox's bounded 3-pane layout) instead of the fixed-height card used elsewhere. */
  fill?: boolean;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [isDemo, setIsDemo] = useState(true);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/whatsapp/conversations/${encodeURIComponent(conversationId)}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to load conversation");
      }
      const data = await res.json();
      setMessages(Array.isArray(data) ? data : (data.messages ?? []));
      if (typeof data.isDemo === "boolean") setIsDemo(data.isDemo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load conversation");
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [
      ...messages.map((message) => ({ kind: "message" as const, at: message.sentAt, message })),
      ...crmEvents.map((event) => ({ kind: "crm" as const, at: event.at, event })),
    ];
    return items.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }, [messages, crmEvents]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [timeline.length]);

  async function sendMessage() {
    if (!body.trim() || sending) return;
    setSending(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch("/api/whatsapp/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          leadId,
          body: body.trim(),
          direction: "OUTBOUND",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to send");
      setBody("");
      setNotice(data.notice ?? (data.demo ? "Demo WhatsApp message generated." : "Message sent."));
      await load();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }

  async function simulateInbound() {
    setSending(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch("/api/whatsapp/simulate-inbound", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          leadId,
          body: "Thanks — can we schedule a site visit this weekend?",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to simulate inbound");
      setNotice(data.notice ?? "Simulated inbound Demo WhatsApp message.");
      await load();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to simulate inbound");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={cn("flex flex-col border border-border bg-surface", fill ? "h-full" : "")}>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-medium tracking-tight">WhatsApp</h3>
          <p className="mt-0.5 text-xs text-muted">
            {isDemo ? "Tied to this lead · demo send never leaves the CRM" : "Tied to this lead · WhatsApp Business"}
          </p>
        </div>
        <Badge tone={isDemo ? "accent" : "success"}>{isDemo ? "Demo" : "Live"}</Badge>
      </div>

      <div
        className={cn(
          "flex min-h-[240px] flex-col gap-3 overflow-y-auto py-4",
          fill ? "flex-1" : "max-h-[420px]",
        )}
      >
        {loading ? (
          <div className="py-10 text-center text-sm text-muted">Loading conversation…</div>
        ) : timeline.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted">No messages yet.</div>
        ) : (
          timeline.map((item) => {
            if (item.kind === "crm") {
              return (
                <div key={item.event.id} className="mx-auto max-w-[85%] text-center">
                  <div className="inline-block border border-border bg-background px-3 py-1.5 text-left">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">CRM event</div>
                    <div className="mt-0.5 text-[12px] font-medium">{item.event.title}</div>
                    {item.event.detail ? (
                      <div className="mt-0.5 text-[11px] text-muted">{item.event.detail}</div>
                    ) : null}
                  </div>
                  <div className="mono mt-1 text-[10px] text-muted">{formatDateTimePK(item.at)}</div>
                </div>
              );
            }

            const msg = item.message;
            const outbound = msg.direction === "OUTBOUND";
            const system = msg.direction === "SYSTEM";
            if (system) {
              return (
                <div key={msg.id} className="mx-auto max-w-[80%] text-center">
                  <span className="inline-block bg-white/80 px-3 py-1 text-[11px] text-muted">
                    {msg.body}
                  </span>
                  <div className="mono mt-1 text-[10px] text-muted">{formatDateTimePK(msg.sentAt)}</div>
                </div>
              );
            }
            return (
              <div
                key={msg.id}
                className={cn("flex", outbound ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[75%] px-3 py-2 text-sm shadow-sm",
                    outbound
                      ? "border border-border bg-accent-soft px-3 py-2 text-sm"
                      : "border border-border bg-background px-3 py-2 text-sm",
                  )}
                >
                  <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                    {outbound ? "Agent" : "Customer"}
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap break-words">{msg.body}</p>
                  <div className="mono mt-1 flex items-center justify-end gap-2 text-[10px] text-muted">
                    <span>{formatTimePK(msg.sentAt)}</span>
                    {outbound ? <span>{msg.status}</span> : null}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {(notice || error) && (
        <div
          className={cn(
            "shrink-0 border-t border-border px-4 py-2 text-xs",
            error ? "bg-red-50 text-danger" : "bg-accent-soft text-foreground",
          )}
        >
          {error ?? notice}
        </div>
      )}

      <div className="shrink-0 space-y-2 border-t border-border p-3">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={isDemo ? "Type a demo WhatsApp message…" : "Type a WhatsApp message…"}
          rows={2}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void sendMessage();
            }
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="accent" size="sm" disabled={sending || !body.trim()} onClick={() => void sendMessage()}>
            {isDemo ? "Send demo message" : "Send message"}
          </Button>
          {isDemo ? (
            <Button type="button" variant="outline" size="sm" disabled={sending} onClick={() => void simulateInbound()}>
              Simulate inbound
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
