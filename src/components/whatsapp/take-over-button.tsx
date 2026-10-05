"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useCan } from "@/components/providers/permissions";

/**
 * `ownedByOther`: someone else owns the lead. Taking it over is then a reassignment, which the server only allows
 * with leads:assign, so other roles are not offered the button (the server still refuses if they try).
 */
export function TakeOverButton({ leadId, ownedByOther = false }: { leadId: string; ownedByOther?: boolean }) {
  const canWrite = useCan("crm:write");
  const canReassign = useCan("leads:assign");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function takeOver() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/take-over`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to take over conversation");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to take over conversation");
    } finally {
      setPending(false);
    }
  }

  if (!canWrite || (ownedByOther && !canReassign)) return null;

  return (
    <div>
      <Button type="button" size="sm" variant="danger" disabled={pending} onClick={() => void takeOver()}>
        {pending ? "Taking over…" : "Take over conversation"}
      </Button>
      {error ? <p role="alert" className="mt-1 text-[11px] text-danger">{error}</p> : null}
    </div>
  );
}
