"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { LeadSource } from "@prisma/client";
import { useCan } from "@/components/providers/permissions";
import { Button } from "@/components/ui/button";
import { sourceLabel } from "@/lib/dashboard-ui";
import { leadSourceEnum } from "@/lib/validations/common";

/**
 * Which lead sources this workspace actually gets leads from. Feeds the "N of M declared sources have a live feed"
 * coverage line on Team Health. Editing needs workspace:write; everyone else sees the list read-only.
 */
export function SourceDeclarations({ declared }: { declared: LeadSource[] }) {
  const router = useRouter();
  const canEdit = useCan("workspace:write");
  const [selected, setSelected] = useState<Set<LeadSource>>(new Set(declared));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/workspace/sources", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sources: [...selected] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to save lead sources");
      setStatus({ ok: true, text: "Lead sources saved." });
      router.refresh();
    } catch (err) {
      setStatus({ ok: false, text: err instanceof Error ? err.message : "Failed to save lead sources" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="text-sm font-medium">Lead sources you use</div>
      <p className="mt-1 text-sm text-muted">
        Declare where this workspace&apos;s leads come from. Team Health compares this list with the sources that have a
        live feed (today: WhatsApp only; CSV import and manual entry are not feeds).
      </p>
      {canEdit ? (
        <>
          <fieldset className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" disabled={saving}>
            <legend className="sr-only">Declared lead sources</legend>
            {leadSourceEnum.options.map((source) => (
              <label key={source} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.has(source)}
                  onChange={(e) =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(source);
                      else next.delete(source);
                      return next;
                    })
                  }
                />
                {sourceLabel(source)}
              </label>
            ))}
          </fieldset>
          <Button type="button" variant="accent" className="mt-3" disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save lead sources"}
          </Button>
          {status ? (
            <p role={status.ok ? "status" : "alert"} className={`mt-2 text-sm ${status.ok ? "text-accent-text" : "text-danger"}`}>
              {status.text}
            </p>
          ) : null}
        </>
      ) : (
        <p className="mt-2 text-sm">
          {declared.length === 0 ? "None declared yet." : declared.map(sourceLabel).join(", ")}
          <span className="text-muted"> Only the workspace owner or an admin can change this.</span>
        </p>
      )}
    </div>
  );
}
