"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { formatDateTimePK } from "@/lib/format";

type Note = {
  id: string;
  title: string;
  body?: string | null;
  href?: string | null;
  readAt?: string | null;
  createdAt: string;
  type: string;
};

export function NotificationsMenu() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Note[]>([]);
  const [unread, setUnread] = useState(0);

  const load = useCallback(async () => {
    const res = await fetch("/api/notifications");
    if (!res.ok) return;
    const data = await res.json();
    setItems(data.items ?? []);
    setUnread(data.unread ?? 0);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 12000);
    return () => clearInterval(t);
  }, [load]);

  async function mark(id?: string) {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(id ? { id } : { all: true }),
    });
    await load();
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface text-foreground"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-[12px] border border-border bg-surface shadow-[var(--shadow)]">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-[13px] font-semibold">Notifications</span>
            <button type="button" className="text-[12px] text-muted hover:text-foreground" onClick={() => void mark()}>
              Mark all read
            </button>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-3 py-6 text-sm text-muted">No notifications yet.</div>
            ) : (
              items.map((n) => (
                <Link
                  key={n.id}
                  href={n.href ?? "/dashboard"}
                  onClick={() => {
                    void mark(n.id);
                    setOpen(false);
                  }}
                  className="block border-b border-border px-3 py-2 hover:bg-background"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm">{n.title}</span>
                    {!n.readAt ? <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" /> : null}
                  </div>
                  {n.body ? <div className="mt-0.5 text-xs text-muted">{n.body}</div> : null}
                  <div className="meta mt-1">{formatDateTimePK(n.createdAt)}</div>
                </Link>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
