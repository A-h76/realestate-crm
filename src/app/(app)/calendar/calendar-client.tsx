"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Plus } from "lucide-react";
import { DemoBanner } from "@/components/demo-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTimePK } from "@/lib/format";

export type CalendarEventRow = {
  id: string;
  title: string;
  type: string;
  status: string;
  startAt: string;
  endAt: string;
  location?: string | null;
  notes?: string | null;
  provider?: string | null;
  lead?: { id: string; firstName: string; lastName?: string | null } | null;
  opportunity?: { id: string; name: string } | null;
  owner?: { name: string } | null;
};

export function CalendarClient({
  initialEvents,
  leads,
  opportunities,
}: {
  initialEvents: CalendarEventRow[];
  leads: { id: string; firstName: string; lastName?: string | null }[];
  opportunities: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [events, setEvents] = useState(initialEvents);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    startAt: "",
    endAt: "",
    location: "",
    notes: "",
    leadId: "",
    opportunityId: "",
  });

  async function createSiteVisit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.startAt || !form.endAt || creating) return;
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          type: "SITE_VISIT",
          startAt: new Date(form.startAt).toISOString(),
          endAt: new Date(form.endAt).toISOString(),
          location: form.location.trim() || undefined,
          notes: form.notes.trim() || undefined,
          leadId: form.leadId || undefined,
          opportunityId: form.opportunityId || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to create event");
      setNotice("Demo calendar event generated — no real Google Calendar action");
      setOpen(false);
      setForm({
        title: "",
        startAt: "",
        endAt: "",
        location: "",
        notes: "",
        leadId: "",
        opportunityId: "",
      });
      router.refresh();
      if (data.id) {
        setEvents((prev) =>
          [
            {
              id: data.id,
              title: data.title ?? form.title,
              type: data.type ?? "SITE_VISIT",
              status: data.status ?? "SCHEDULED",
              startAt: data.startAt ?? new Date(form.startAt).toISOString(),
              endAt: data.endAt ?? new Date(form.endAt).toISOString(),
              location: data.location ?? form.location,
              notes: data.notes ?? form.notes,
              provider: data.provider ?? "demo",
              lead: data.lead ?? null,
              opportunity: data.opportunity ?? null,
              owner: data.owner ?? null,
            },
            ...prev,
          ].sort(
            (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
          ),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create event");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-4">
      <DemoBanner
        label="Demo Calendar"
        detail="Site visits are logged locally — no Google Calendar sync"
      />

      <div className="flex justify-end">
        <Button type="button" variant="accent" size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          Schedule site visit
        </Button>
      </div>

      {notice ? (
        <div className="border border-accent/25 bg-accent-soft px-3 py-2 text-sm">{notice}</div>
      ) : null}
      {error ? (
        <div className="border border-danger/30 bg-red-50 px-3 py-2 text-sm text-danger">{error}</div>
      ) : null}

      <div className="divide-y divide-border border border-border bg-surface">
        {events.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted">No calendar events.</div>
        ) : (
          events.map((ev) => (
            <div key={ev.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{ev.title}</span>
                {ev.type === "SITE_VISIT" ? (
                  <Badge tone="accent" className="gap-1">
                    <MapPin className="h-3 w-3" />
                    Site Visit
                  </Badge>
                ) : (
                  <Badge tone="neutral">{ev.type.replaceAll("_", " ")}</Badge>
                )}
                <Badge tone="neutral">{ev.status}</Badge>
                <Badge tone="accent">Demo Calendar</Badge>
              </div>
              <div className="mono mt-2 text-[11px] text-muted">
                {formatDateTimePK(ev.startAt)} → {formatDateTimePK(ev.endAt)}
              </div>
              <div className="mt-1 text-xs text-muted">
                {ev.location ?? "Location TBD"}
                {ev.lead ? ` · ${ev.lead.firstName} ${ev.lead.lastName ?? ""}` : ""}
                {ev.opportunity ? ` · ${ev.opportunity.name}` : ""}
                {ev.owner?.name ? ` · ${ev.owner.name}` : ""}
              </div>
              {ev.notes ? <p className="mt-2 text-xs text-muted">{ev.notes}</p> : null}
            </div>
          ))
        )}
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg border border-border bg-surface shadow-lg">
            <div className="border-b border-border px-5 py-4">
              <h3 className="flex items-center gap-2 text-lg font-semibold">
                <MapPin className="h-5 w-5 text-accent" />
                Schedule site visit
              </h3>
              <p className="mt-1 text-xs text-muted">
                Creates a demo SITE_VISIT via POST /api/calendar
              </p>
            </div>
            <form onSubmit={(e) => void createSiteVisit(e)} className="space-y-3 p-5">
              <div className="space-y-1.5">
                <Label htmlFor="ctitle">Title</Label>
                <Input
                  id="ctitle"
                  required
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="cstart">Start</Label>
                  <Input
                    id="cstart"
                    type="datetime-local"
                    required
                    value={form.startAt}
                    onChange={(e) => setForm((f) => ({ ...f, startAt: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cend">End</Label>
                  <Input
                    id="cend"
                    type="datetime-local"
                    required
                    value={form.endAt}
                    onChange={(e) => setForm((f) => ({ ...f, endAt: e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cloc">Location</Label>
                <Input
                  id="cloc"
                  value={form.location}
                  onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="clead">Lead</Label>
                <select
                  id="clead"
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
                <Label htmlFor="copp">Opportunity</Label>
                <select
                  id="copp"
                  className="flex h-9 w-full border border-border bg-surface px-3 text-sm"
                  value={form.opportunityId}
                  onChange={(e) => setForm((f) => ({ ...f, opportunityId: e.target.value }))}
                >
                  <option value="">None</option>
                  {opportunities.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cnotes">Notes</Label>
                <Textarea
                  id="cnotes"
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="accent" disabled={creating}>
                  {creating ? "Creating…" : "Create site visit"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
