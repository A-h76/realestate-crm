"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Lead owner. Editable only for roles with leads:assign (server enforces the
 * same rule in POST /api/leads/:id/assign); everyone else sees who owns it.
 */
export function LeadOwnerControl({
  leadId,
  ownerId,
  ownerName,
  members,
  canAssign,
}: {
  leadId: string;
  ownerId: string | null;
  ownerName: string | null;
  members: Array<{ userId: string; name: string; role: string }>;
  canAssign: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canAssign) {
    return <span className="text-xs text-muted">Owner: {ownerName ?? "Unassigned"}</span>;
  }

  async function assign(next: string) {
    if (!next || next === ownerId || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerId: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to assign lead");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign lead");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <select
        aria-label="Lead owner"
        className="h-7 border border-border bg-surface px-2 text-xs font-medium"
        value={ownerId ?? ""}
        disabled={pending}
        onChange={(e) => void assign(e.target.value)}
      >
        {ownerId ? null : <option value="">Unassigned</option>}
        {members.map((m) => (
          <option key={m.userId} value={m.userId}>
            {m.name} · {m.role.toLowerCase()}
          </option>
        ))}
      </select>
      {error ? <span className="text-[11px] text-danger">{error}</span> : null}
    </div>
  );
}
