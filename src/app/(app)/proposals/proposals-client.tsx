"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency, formatDateTimePK } from "@/lib/format";

type ProposalRow = {
  id: string;
  proposalNumber: string;
  status: string;
  value: number;
  viewCount: number;
  sentAt: string | null;
  viewedAt: string | null;
  expiryAt: string | null;
  leadName: string | null;
  opportunityName: string | null;
  propertyTitle: string | null;
  ownerName: string | null;
};

export function ProposalsClient({
  initialProposals,
  opportunities,
  properties,
  leads,
}: {
  initialProposals: ProposalRow[];
  opportunities: Array<{
    id: string;
    name: string;
    value: number;
    leadId: string | null;
    linkedPropertyId: string | null;
  }>;
  properties: Array<{ id: string; title: string }>;
  leads: Array<{ id: string; name: string }>;
}) {
  const [proposals, setProposals] = useState(initialProposals);
  const [showCreate, setShowCreate] = useState(false);
  const [opportunityId, setOpportunityId] = useState(opportunities[0]?.id ?? "");
  const [value, setValue] = useState(String(opportunities[0]?.value ?? 0));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function createProposal() {
    setError(null);
    setNotice(null);
    const opp = opportunities.find((o) => o.id === opportunityId);
    const res = await fetch("/api/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        opportunityId: opportunityId || null,
        leadId: opp?.leadId ?? leads[0]?.id ?? null,
        linkedPropertyId: opp?.linkedPropertyId ?? properties[0]?.id ?? null,
        value: Number(value),
        currency: "PKR",
        status: "DRAFT",
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Create failed");
      return;
    }
    const created = await res.json();
    setProposals((list) => [
      {
        id: created.id,
        proposalNumber: created.proposalNumber,
        status: created.status,
        value: Number(created.value),
        viewCount: created.viewCount ?? 0,
        sentAt: created.sentAt,
        viewedAt: created.viewedAt,
        expiryAt: created.expiryAt,
        leadName: opp ? leads.find((l) => l.id === opp.leadId)?.name ?? null : null,
        opportunityName: opp?.name ?? null,
        propertyTitle:
          properties.find((p) => p.id === (opp?.linkedPropertyId ?? null))?.title ?? null,
        ownerName: null,
      },
      ...list,
    ]);
    setShowCreate(false);
    setNotice("Proposal created.");
  }

  async function patchStatus(id: string, status: string) {
    setError(null);
    setNotice(null);
    const res = await fetch(`/api/proposals/${id}`, {
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
    setProposals((list) =>
      list.map((p) =>
        p.id === id
          ? {
              ...p,
              status: updated.status,
              sentAt: updated.sentAt,
              viewedAt: updated.viewedAt,
              viewCount: updated.viewCount,
            }
          : p,
      ),
    );
    if (status === "SENT") setNotice("Proposal marked SENT. Follow-up task created.");
    if (status === "VIEWED") setNotice("Proposal marked VIEWED.");
    if (status === "ACCEPTED") {
      setNotice("Simulated acceptance recorded — not a real client e-signature.");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button size="sm" variant="accent" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? "Cancel" : "New proposal"}
        </Button>
      </div>
      {showCreate ? (
        <div className="grid gap-3 border border-border bg-surface p-4 md:grid-cols-3">
          <div className="space-y-1">
            <Label>Opportunity</Label>
            <select
              className="h-9 w-full border border-border bg-surface px-2 text-sm"
              value={opportunityId}
              onChange={(e) => {
                setOpportunityId(e.target.value);
                const opp = opportunities.find((o) => o.id === e.target.value);
                if (opp) setValue(String(opp.value));
              }}
            >
              {opportunities.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Value (PKR)</Label>
            <Input value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button variant="accent" onClick={createProposal}>
              Create draft
            </Button>
          </div>
        </div>
      ) : null}
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {notice ? <p className="text-sm text-accent">{notice}</p> : null}
      <div className="overflow-x-auto border border-border">
        <table className="ops w-full min-w-[900px] text-left">
          <thead>
            <tr>
              <th className="px-3 py-2">Proposal</th>
              <th className="px-3 py-2">Opportunity</th>
              <th className="px-3 py-2">Property</th>
              <th className="px-3 py-2">Value</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Views</th>
              <th className="px-3 py-2">Sent</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-surface">
            {proposals.map((p) => (
              <tr key={p.id}>
                <td className="px-3 py-2 font-medium">{p.proposalNumber}</td>
                <td className="px-3 py-2">{p.opportunityName ?? "—"}</td>
                <td className="px-3 py-2">{p.propertyTitle ?? "—"}</td>
                <td className="px-3 py-2">{formatCurrency(p.value)}</td>
                <td className="px-3 py-2">
                  <Badge tone="neutral">{p.status}</Badge>
                </td>
                <td className="mono px-3 py-2">{p.viewCount}</td>
                <td className="mono px-3 py-2 text-xs">{formatDateTimePK(p.sentAt)}</td>
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    {p.status === "DRAFT" ? (
                      <Button size="sm" variant="outline" onClick={() => patchStatus(p.id, "SENT")}>
                        Mark sent
                      </Button>
                    ) : null}
                    {p.status === "SENT" || p.status === "VIEWED" ? (
                      <Button size="sm" variant="ghost" onClick={() => patchStatus(p.id, "VIEWED")}>
                        Mark viewed
                      </Button>
                    ) : null}
                    {p.status === "SENT" || p.status === "VIEWED" || p.status === "NEGOTIATION" ? (
                      <Button
                        size="sm"
                        variant="accent"
                        title="Demo action — does not represent a real client e-signature."
                        onClick={() => patchStatus(p.id, "ACCEPTED")}
                      >
                        Simulate acceptance
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
