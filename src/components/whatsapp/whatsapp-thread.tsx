"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTimePK, formatTimePK } from "@/lib/format";
import { cn } from "@/lib/utils";

type WhatsAppMessage = {
  id: string;
  direction: "INBOUND" | "OUTBOUND" | "SYSTEM";
  body: string;
  status: string;
  sentAt: string;
  sender?: { name?: string | null } | null;
};

export function WhatsAppThread({
  leadId,
  conversationId,
}: {
  leadId: string;
  conversationId: string;
}) {
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load conversation");
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
      setNotice("Demo WhatsApp message generated");
      await load();
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
      setNotice("Demo inbound WhatsApp message generated");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to simulate inbound");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-medium tracking-tight">WhatsApp</h3>
          <p className="mt-0.5 text-xs text-muted">Tied to this lead · demo send never leaves the CRM</p>
        </div>
        <Badge tone="accent">Demo</Badge>
      </div>

      <div className="flex max-h-[420px] min-h-[240px] flex-col gap-3 overflow-y-auto py-4">
        {loading ? (
          <div className="py-10 text-center text-sm text-muted">Loading conversation…</div>
        ) : messages.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted">No messages yet.</div>
        ) : (
          messages.map((msg) => {
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
                  <p className="whitespace-pre-wrap break-words">{msg.body}</p>
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
            "border-t border-border px-4 py-2 text-xs",
            error ? "bg-red-50 text-danger" : "bg-accent-soft text-foreground",
          )}
        >
          {error ?? notice}
        </div>
      )}

      <div className="space-y-2 border-t border-border p-3">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Type a demo WhatsApp message…"
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
            Send demo message
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={sending} onClick={() => void simulateInbound()}>
            Simulate inbound
          </Button>
        </div>
      </div>
    </div>
  );
}
