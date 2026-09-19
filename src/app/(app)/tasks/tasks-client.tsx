"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTimePK } from "@/lib/format";

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueAt: string | null;
  completedAt: string | null;
  ownerName: string | null;
  leadName: string | null;
  opportunityName: string | null;
};

type View = "TODAY" | "UPCOMING" | "OVERDUE" | "COMPLETED";

export function TasksClient({ initialTasks }: { initialTasks: TaskRow[] }) {
  const [tasks, setTasks] = useState(initialTasks);
  const [view, setView] = useState<View>("TODAY");
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    return tasks.filter((t) => {
      if (view === "COMPLETED") return t.status === "DONE";
      if (t.status === "DONE" || t.status === "CANCELLED") return false;
      if (!t.dueAt) return view === "UPCOMING";
      const due = new Date(t.dueAt);
      if (view === "TODAY") return due >= start && due < end;
      if (view === "OVERDUE") return due < start;
      if (view === "UPCOMING") return due >= end;
      return true;
    });
  }, [tasks, view]);

  async function setStatus(id: string, status: string) {
    setError(null);
    const res = await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Update failed");
      return;
    }
    const updated = await res.json();
    setTasks((list) =>
      list.map((t) =>
        t.id === id
          ? {
              ...t,
              status: updated.status,
              completedAt: updated.completedAt ?? null,
            }
          : t,
      ),
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(["TODAY", "UPCOMING", "OVERDUE", "COMPLETED"] as View[]).map((v) => (
          <Button
            key={v}
            size="sm"
            variant={view === v ? "accent" : "outline"}
            onClick={() => setView(v)}
          >
            {v}
          </Button>
        ))}
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <div className="divide-y divide-border border border-border bg-surface">
        {filtered.length === 0 ? (
          <div className="px-4 py-8 text-sm text-muted">No tasks in this view.</div>
        ) : (
          filtered.map((t) => (
            <div key={t.id} className="flex flex-wrap items-start justify-between gap-4 px-4 py-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{t.title}</span>
                  <Badge
                    tone={
                      t.priority === "URGENT" || t.priority === "HIGH"
                        ? "danger"
                        : t.priority === "MEDIUM"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {t.priority}
                  </Badge>
                  <Badge tone="neutral">{t.status}</Badge>
                </div>
                <div className="mono mt-1 text-[11px] text-muted">
                  Due {formatDateTimePK(t.dueAt)}
                </div>
                <div className="mt-1 text-xs text-muted">
                  {[t.ownerName, t.leadName, t.opportunityName].filter(Boolean).join(" · ")}
                </div>
              </div>
              <div className="flex gap-2">
                {t.status !== "DONE" ? (
                  <Button size="sm" variant="outline" onClick={() => setStatus(t.id, "DONE")}>
                    Complete
                  </Button>
                ) : null}
                {t.status === "TODO" ? (
                  <Button size="sm" variant="ghost" onClick={() => setStatus(t.id, "IN_PROGRESS")}>
                    Start
                  </Button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
