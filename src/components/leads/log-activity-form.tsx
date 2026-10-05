"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCan } from "@/components/providers/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MANUAL_ACTIVITY_TYPES } from "@/lib/validations/activities";

const LABELS: Record<(typeof MANUAL_ACTIVITY_TYPES)[number], string> = {
  CALL: "Call",
  EMAIL: "Email",
  MEETING: "Meeting",
  NOTE: "Note",
  FOLLOW_UP: "Follow-up",
};

/** Entry point for POST /api/activities: lets a person record what happened off-system (a call, a meeting...). */
export function LogActivityForm({ leadId }: { leadId: string }) {
  const router = useRouter();
  const canWrite = useCan("crm:write");
  const [type, setType] = useState<(typeof MANUAL_ACTIVITY_TYPES)[number]>("CALL");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (!canWrite) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          leadId,
          status: "COMPLETED",
          title: title.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not log the activity");
      setTitle("");
      setNotes("");
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not log the activity");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="mt-6 max-w-xl space-y-3 border-t border-border pt-4">
      <div className="section-kicker">Log an activity</div>
      <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
        <div className="space-y-1.5">
          <Label htmlFor="activity-type">Type</Label>
          <select
            id="activity-type"
            className="h-9 w-full border border-border bg-surface px-2 text-sm"
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
          >
            {MANUAL_ACTIVITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="activity-title">Title (optional)</Label>
          <Input id="activity-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="activity-notes">What happened</Label>
        <Textarea id="activity-notes" rows={3} value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="text-sm text-accent-text">
          Activity logged.
        </p>
      ) : null}
      <Button type="submit" size="sm" variant="accent" disabled={saving || (!notes.trim() && !title.trim())}>
        {saving ? "Saving…" : "Log activity"}
      </Button>
    </form>
  );
}
