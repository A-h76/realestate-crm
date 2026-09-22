"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const LEAD_STAGES = ["NEW", "CONTACTED", "QUALIFIED", "NURTURING", "CONVERTED", "LOST", "ARCHIVED"] as const;

/**
 * The only place a Lead's stage can be changed from the UI — previously it
 * only rendered as a read-only Badge, so an agent had no way to move a lead
 * past NEW without calling the API directly (PATCH /api/leads/:id already
 * supported `stage`, including its audit trail and QUALIFIED automation).
 */
export function LeadStageControl({ leadId, stage }: { leadId: string; stage: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function changeStage(next: string) {
    if (next === stage || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to update stage");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update stage");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <select
        aria-label="Lead stage"
        className="h-7 border border-border bg-surface px-2 text-xs font-medium"
        value={stage}
        disabled={pending}
        onChange={(e) => void changeStage(e.target.value)}
      >
        {LEAD_STAGES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      {error ? <span className="text-[11px] text-danger">{error}</span> : null}
    </div>
  );
}
