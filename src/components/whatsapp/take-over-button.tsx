"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function TakeOverButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function takeOver() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/take-over`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to take over");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to take over");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <Button type="button" size="sm" variant="danger" disabled={pending} onClick={() => void takeOver()}>
        {pending ? "Taking over…" : "Take over"}
      </Button>
      {error ? <p className="mt-1 text-[11px] text-danger">{error}</p> : null}
    </div>
  );
}
