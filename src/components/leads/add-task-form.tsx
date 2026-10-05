"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCan } from "@/components/providers/permissions";

/** Creates a task on one lead via POST /api/tasks (server re-checks permission and lead ownership). */
export function AddTaskForm({ leadId }: { leadId: string }) {
  const canWrite = useCan("crm:write");
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canWrite) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          leadId,
          ...(due ? { dueAt: new Date(`${due}T09:00:00`).toISOString() } : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not add the task");
      }
      setTitle("");
      setDue("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the task");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form id="add-task" onSubmit={(e) => void submit(e)} className="mt-4 flex flex-wrap items-end gap-2">
      <label className="min-w-[200px] flex-1 text-xs text-muted">
        What needs to happen?
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Call to confirm Saturday showing" />
      </label>
      <label className="text-xs text-muted">
        When
        <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </label>
      <Button type="submit" size="sm" variant="accent" disabled={busy || !title.trim()}>
        {busy ? "Adding…" : "Add task"}
      </Button>
      {error ? (
        <p role="alert" className="w-full text-xs text-danger">
          {error}
        </p>
      ) : null}
    </form>
  );
}
