"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency, formatDatePK } from "@/lib/format";

export type OpportunityListItem = {
  id: string;
  name: string;
  dealSide: "BUYER" | "SELLER";
  value: string | number;
  probability: number;
  stageEnteredAt: string;
  createdAt: string;
  expectedCloseDate?: string | null;
  stage: { id: string; name: string; probability: number };
  owner?: { name: string } | null;
  linkedProperty?: { id: string; title: string } | null;
  lead?: { id: string; firstName: string; lastName?: string | null } | null;
};

export type StageOption = { id: string; name: string; probability: number };
export type LeadOption = { id: string; firstName: string; lastName?: string | null };
export type PropertyOption = { id: string; title: string };

function daysBetween(from: string | Date, to = new Date()) {
  const a = typeof from === "string" ? new Date(from) : from;
  return Math.max(0, Math.floor((to.getTime() - a.getTime()) / 86400000));
}

export function OpportunitiesClient({
  initialOpportunities,
  stages,
  leads,
  properties,
}: {
  initialOpportunities: OpportunityListItem[];
  stages: StageOption[];
  leads: LeadOption[];
  properties: PropertyOption[];
}) {
  const router = useRouter();
  const [opps, setOpps] = useState(initialOpportunities);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    dealSide: "BUYER" as "BUYER" | "SELLER",
    value: "",
    stageId: stages[0]?.id ?? "",
    leadId: "",
    linkedPropertyId: "",
    description: "",
  });

  async function createOpportunity(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.stageId || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/opportunities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          dealSide: form.dealSide,
          value: Number(form.value) || 0,
          stageId: form.stageId,
          leadId: form.leadId || undefined,
          linkedPropertyId: form.linkedPropertyId || undefined,
          description: form.description.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to create opportunity");
      setOpen(false);
      setForm({
        name: "",
        dealSide: "BUYER",
        value: "",
        stageId: stages[0]?.id ?? "",
        leadId: "",
        linkedPropertyId: "",
        description: "",
      });
      router.refresh();
      if (data.id) {
        setOpps((prev) => [
          {
            id: data.id,
            name: data.name ?? form.name,
            dealSide: data.dealSide ?? form.dealSide,
            value: data.value ?? form.value,
            probability: data.probability ?? 0,
            stageEnteredAt: data.stageEnteredAt ?? new Date().toISOString(),
            createdAt: data.createdAt ?? new Date().toISOString(),
            stage: data.stage ?? stages.find((s) => s.id === form.stageId)!,
            linkedProperty: data.linkedProperty ?? null,
            lead: data.lead ?? null,
            owner: data.owner ?? null,
          },
          ...prev,
        ]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button type="button" variant="accent" size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          New opportunity
        </Button>
      </div>

      {error ? (
        <div className="border border-danger/30 bg-red-50 px-3 py-2 text-sm text-danger">{error}</div>
      ) : null}

      <div className="overflow-x-auto border border-border bg-surface">
        <table className="ops w-full min-w-[1000px] text-left">
          <thead>
            <tr>
              <th className="px-3 py-2">Opportunity</th>
              <th className="px-3 py-2">Side</th>
              <th className="px-3 py-2">Stage</th>
              <th className="px-3 py-2">Value</th>
              <th className="px-3 py-2">Weighted</th>
              <th className="px-3 py-2">Days open</th>
              <th className="px-3 py-2">Days in stage</th>
              <th className="px-3 py-2">Property</th>
              <th className="px-3 py-2">Owner</th>
              <th className="px-3 py-2">Close</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {opps.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-muted">
                  No opportunities yet.
                </td>
              </tr>
            ) : (
              opps.map((o) => {
                const prob = o.probability || o.stage.probability;
                const weighted = (Number(o.value) * prob) / 100;
                return (
                  <tr key={o.id} className="hover:bg-background/80">
                    <td className="px-3 py-2">
                      <Link
                        href={`/opportunities/${o.id}`}
                        className="font-medium hover:text-accent"
                      >
                        {o.name}
                      </Link>
                      {o.lead ? (
                        <div className="text-xs text-muted">
                          Lead: {o.lead.firstName} {o.lead.lastName ?? ""}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={o.dealSide === "BUYER" ? "accent" : "warning"}>
                        {o.dealSide}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-muted">{o.stage.name}</td>
                    <td className="px-3 py-2 mono">{formatCurrency(Number(o.value))}</td>
                    <td className="px-3 py-2 mono text-muted">{formatCurrency(weighted)}</td>
                    <td className="px-3 py-2 mono">{daysBetween(o.createdAt)}</td>
                    <td className="px-3 py-2 mono">{daysBetween(o.stageEnteredAt)}</td>
                    <td className="px-3 py-2">
                      {o.linkedProperty ? (
                        <Link
                          href={`/properties/${o.linkedProperty.id}`}
                          className="text-xs hover:text-accent"
                        >
                          {o.linkedProperty.title}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted">{o.owner?.name ?? "—"}</td>
                    <td className="px-3 py-2 mono text-[11px] text-muted">
                      {formatDatePK(o.expectedCloseDate)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg border border-border bg-surface shadow-lg">
            <div className="border-b border-border px-5 py-4">
              <h3 className="text-lg font-semibold">Create opportunity</h3>
            </div>
            <form onSubmit={(e) => void createOpportunity(e)} className="space-y-3 p-5">
              <div className="space-y-1.5">
                <Label htmlFor="opp-name">Name</Label>
                <Input
                  id="opp-name"
                  required
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="dealSide">Deal side</Label>
                  <select
                    id="dealSide"
                    className="flex h-9 w-full border border-border bg-surface px-3 text-sm"
                    value={form.dealSide}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        dealSide: e.target.value as "BUYER" | "SELLER",
                      }))
                    }
                  >
                    <option value="BUYER">BUYER</option>
                    <option value="SELLER">SELLER</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="value">Value (PKR)</Label>
                  <Input
                    id="value"
                    type="number"
                    min={0}
                    value={form.value}
                    onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="stageId">Stage</Label>
                <select
                  id="stageId"
                  className="flex h-9 w-full border border-border bg-surface px-3 text-sm"
                  value={form.stageId}
                  onChange={(e) => setForm((f) => ({ ...f, stageId: e.target.value }))}
                  required
                >
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="leadId">Lead</Label>
                <select
                  id="leadId"
                  className="flex h-9 w-full border border-border bg-surface px-3 text-sm"
                  value={form.leadId}
                  onChange={(e) => setForm((f) => ({ ...f, leadId: e.target.value }))}
                >
                  <option value="">None</option>
                  {leads.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.firstName} {l.lastName ?? ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="propertyId">Property</Label>
                <select
                  id="propertyId"
                  className="flex h-9 w-full border border-border bg-surface px-3 text-sm"
                  value={form.linkedPropertyId}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, linkedPropertyId: e.target.value }))
                  }
                >
                  <option value="">None</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="desc">Description</Label>
                <Textarea
                  id="desc"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="accent" disabled={creating}>
                  {creating ? "Creating…" : "Create"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
