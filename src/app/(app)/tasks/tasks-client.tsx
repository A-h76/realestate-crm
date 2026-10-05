"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCan } from "@/components/providers/permissions";
import { DEFAULT_TIMEZONE, formatDateTime } from "@/lib/format";

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
  leadId?: string | null;
  opportunityId?: string | null;
};

type View = "TODAY" | "UPCOMING" | "OVERDUE" | "COMPLETED";

const VIEW_LABEL: Record<View, string> = {
  TODAY: "Today",
  UPCOMING: "Upcoming",
  OVERDUE: "Overdue",
  COMPLETED: "Completed",
};

const EMPTY: Record<View, string> = {
  TODAY: "You're all caught up. Nothing is due today.",
  UPCOMING: "Nothing coming up. Add a task from any lead to plan ahead.",
  OVERDUE: "Nothing is overdue.",
  COMPLETED: "Completed tasks will show up here.",
};

function inView(t: TaskRow, view: View, start: Date, end: Date) {
  if (view === "COMPLETED") return t.status === "DONE";
  if (t.status === "DONE" || t.status === "CANCELLED") return false;
  if (!t.dueAt) return view === "UPCOMING";
  const due = new Date(t.dueAt);
  if (view === "TODAY") return due >= start && due < end;
  if (view === "OVERDUE") return due < start;
  return due >= end;
}

export function TasksClient({
  initialTasks,
  dayStartIso,
  dayEndIso,
  timeZone = DEFAULT_TIMEZONE,
}: {
  initialTasks: TaskRow[];
  /** The workspace-local day, from the server, so "Today" means the same thing everywhere. */
  dayStartIso?: string;
  dayEndIso?: string;
  timeZone?: string;
}) {
  const canWrite = useCan("crm:write");
  const [tasks, setTasks] = useState(initialTasks);
  const [error, setError] = useState<string | null>(null);

  const { start, end } = useMemo(() => {
    if (dayStartIso && dayEndIso) return { start: new Date(dayStartIso), end: new Date(dayEndIso) };
    const s = new Date();
    s.setHours(0, 0, 0, 0);
    const e = new Date(s);
    e.setDate(e.getDate() + 1);
    return { start: s, end: e };
  }, [dayStartIso, dayEndIso]);

  const counts = useMemo(
    () =>
      Object.fromEntries(
        (Object.keys(VIEW_LABEL) as View[]).map((v) => [v, tasks.filter((t) => inView(t, v, start, end)).length]),
      ) as Record<View, number>,
    [tasks, start, end],
  );
  // Land where the work is: today's tasks, or the overdue pile if today is clear.
  const [view, setView] = useState<View>(counts.TODAY === 0 && counts.OVERDUE > 0 ? "OVERDUE" : "TODAY");
  const filtered = useMemo(() => tasks.filter((t) => inView(t, view, start, end)), [tasks, view, start, end]);

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
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Task views">
        {(Object.keys(VIEW_LABEL) as View[]).map((v) => (
          <Button
            key={v}
            size="sm"
            role="tab"
            aria-selected={view === v}
            variant={view === v ? "accent" : "outline"}
            onClick={() => setView(v)}
          >
            {VIEW_LABEL[v]}
            <span className="text-[11px] opacity-70">{counts[v]}</span>
          </Button>
        ))}
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <div className="divide-y divide-border border border-border bg-surface">
        {filtered.length === 0 ? (
          <div className="px-4 py-8 text-sm text-muted">{EMPTY[view]}</div>
        ) : (
          filtered.map((t) => (
            <div key={t.id} className="flex flex-wrap items-start justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{t.title}</span>
                  {t.priority === "URGENT" || t.priority === "HIGH" ? <Badge tone="danger">{t.priority}</Badge> : null}
                  {view === "OVERDUE" ? <Badge tone="danger">Overdue</Badge> : null}
                </div>
                <div className="mt-1 text-xs text-muted">
                  {t.dueAt ? `Due ${formatDateTime(t.dueAt, timeZone)}` : "No due date"} · Owner: {t.ownerName ?? "Unassigned"}
                </div>
                {t.leadName || t.opportunityName ? (
                  <div className="mt-1 text-xs">
                    {t.leadName ? (
                      t.leadId ? (
                        <Link href={`/leads/${t.leadId}`} className="text-accent-text hover:underline">
                          {t.leadName}
                        </Link>
                      ) : (
                        <span className="text-muted">{t.leadName}</span>
                      )
                    ) : null}
                    {t.leadName && t.opportunityName ? <span className="text-muted"> · </span> : null}
                    {t.opportunityName ? (
                      t.opportunityId ? (
                        <Link href={`/opportunities/${t.opportunityId}`} className="text-accent-text hover:underline">
                          {t.opportunityName}
                        </Link>
                      ) : (
                        <span className="text-muted">{t.opportunityName}</span>
                      )
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="flex gap-2">
                {canWrite && t.status !== "DONE" ? (
                  <Button size="sm" variant="outline" onClick={() => setStatus(t.id, "DONE")}>
                    Complete
                  </Button>
                ) : null}
                {canWrite && t.status === "TODO" ? (
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
