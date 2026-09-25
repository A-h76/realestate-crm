"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTimePK } from "@/lib/format";

type Automation = {
  id: string;
  name: string;
  trigger: string;
  enabled: boolean;
  paused: boolean;
};

type Execution = {
  id: string;
  trigger: string;
  action: string;
  status: string;
  result?: string | null;
  error?: string | null;
  durationMs?: number | null;
  createdAt: string;
  leadId?: string | null;
  opportunityId?: string | null;
  automation: { name: string };
};

export default function AutomationsPage() {
  const [items, setItems] = useState<Automation[]>([]);
  const [execs, setExecs] = useState<Execution[]>([]);
  const [selected, setSelected] = useState<Execution | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);

  const load = useCallback(async () => {
    const [a, e] = await Promise.all([fetch("/api/automations"), fetch("/api/automations/executions")]);
    const ad = await a.json();
    const ed = await e.json();
    if (!a.ok) throw new Error(ad.error ?? "Failed");
    setItems(ad.items ?? []);
    setCanManage(Boolean(ad.canManage));
    setExecs(ed.items ?? []);
  }, []);

  useEffect(() => {
    void load().catch((err: Error) => setError(err.message));
  }, [load]);

  async function toggle(item: Automation, field: "paused" | "enabled") {
    await fetch("/api/automations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, [field]: !item[field] }),
    });
    await load();
  }

  return (
    <div className="page-in space-y-10 p-6 md:p-10">
      <PageHeader
        eyebrow="Human control"
        title="Automations"
        description="Deterministic flows with pause, resume, and a full execution log. AI never sends outbound messages."
      />
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <section className="divide-y divide-border">
        {items.map((item) => (
          <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div>
              <div className="text-sm font-medium">{item.name}</div>
              <div className="meta mt-1">{item.trigger.replaceAll("_", " ")}</div>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={item.paused || !item.enabled ? "warning" : "accent"}>
                {item.paused ? "Paused" : item.enabled ? "Live" : "Off"}
              </Badge>
              <Button
                size="sm"
                variant="outline"
                disabled={!canManage}
                title={canManage ? undefined : "Only the owner or an admin can pause automations"}
                onClick={() => void toggle(item, "paused")}
              >
                {item.paused ? "Resume" : "Pause"}
              </Button>
            </div>
          </div>
        ))}
      </section>

      <section>
        <div className="section-kicker">Execution log</div>
        <div className="mt-4 overflow-x-auto">
          <table className="ops w-full text-left text-sm">
            <thead>
              <tr className="meta">
                <th className="py-2 font-medium">When</th>
                <th className="py-2 font-medium">Automation</th>
                <th className="py-2 font-medium">Action</th>
                <th className="py-2 font-medium">Status</th>
                <th className="py-2 font-medium">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {execs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-muted">
                    No automation runs yet. Stage a deal or create a lead to see the log.
                  </td>
                </tr>
              ) : (
                execs.map((row) => (
                  <tr
                    key={row.id}
                    className="cursor-pointer hover:bg-surface"
                    onClick={() => setSelected(row)}
                  >
                    <td className="mono py-3 text-[11px]">{formatDateTimePK(row.createdAt)}</td>
                    <td className="py-3">{row.automation.name}</td>
                    <td className="py-3 text-muted">{row.action}</td>
                    <td className="py-3">{row.status}</td>
                    <td className="mono py-3">{row.durationMs ?? "—"}ms</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selected ? (
        <div className="fixed inset-0 z-40 bg-foreground/20" onClick={() => setSelected(null)}>
          <div
            className="absolute right-0 top-0 h-full w-full max-w-md overflow-y-auto border-l border-border bg-surface p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="section-kicker">Execution</div>
            <h2 className="mt-2 text-xl font-medium">{selected.automation.name}</h2>
            <dl className="mt-6 space-y-3 text-sm">
              <div>
                <dt className="section-kicker">Status</dt>
                <dd className="mt-1">{selected.status}</dd>
              </div>
              <div>
                <dt className="section-kicker">Trigger</dt>
                <dd className="mt-1">{selected.trigger}</dd>
              </div>
              <div>
                <dt className="section-kicker">Result</dt>
                <dd className="mt-1">{selected.result ?? "—"}</dd>
              </div>
              <div>
                <dt className="section-kicker">Error</dt>
                <dd className="mt-1">{selected.error ?? "—"}</dd>
              </div>
            </dl>
            <Button className="mt-8" variant="outline" onClick={() => setSelected(null)}>
              Close
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
