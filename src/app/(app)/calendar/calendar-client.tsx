"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MapPin, Plus } from "lucide-react";
import { DemoBanner } from "@/components/demo-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCan } from "@/components/providers/permissions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_TIMEZONE, formatDate, formatDateTime } from "@/lib/format";

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
  nowIso = new Date().toISOString(),
  timeZone = DEFAULT_TIMEZONE,
  initialLeadId,
}: {
  /** Server clock, so the upcoming/past split renders identically on server and client. */
  nowIso?: string;
  timeZone?: string;
  initialLeadId?: string;
  initialEvents: CalendarEventRow[];
  leads: { id: string; firstName: string; lastName?: string | null }[];
  opportunities: { id: string; name: string }[];
}) {
  const canWrite = useCan("calendar:write");
  const router = useRouter();
  const [events, setEvents] = useState(initialEvents);
  const [open, setOpen] = useState(Boolean(initialLeadId));
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    startAt: "",
    endAt: "",
    location: "",
    notes: "",
    leadId: initialLeadId ?? "",
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
      setNotice("Site visit saved to the CRM calendar — no external calendar was updated");
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
        label="Internal CRM calendar"
        detail="Site visits are stored in the CRM only — not synced to any external calendar"
      />

      <div className="flex justify-end">
        {canWrite ? (
        <Button type="button" variant="accent" size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          Schedule showing
        </Button>
        ) : null}
      </div>

      {notice ? (
        <div className="border border-accent/25 bg-accent-soft px-3 py-2 text-sm">{notice}</div>
      ) : null}
      {error ? (
        <div className="border border-danger/30 bg-red-50 px-3 py-2 text-sm text-danger">{error}</div>
      ) : null}

      <EventList events={events} nowIso={nowIso} timeZone={timeZone} />

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg border border-border bg-surface shadow-lg">
            <div className="border-b border-border px-5 py-4">
              <h3 className="flex items-center gap-2 text-lg font-semibold">
                <MapPin className="h-5 w-5 text-accent" />
                Schedule showing
              </h3>
              <p className="mt-1 text-xs text-muted">
                Saves a SITE_VISIT to the CRM calendar
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
                  {creating ? "Creating…" : "Create showing"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const TYPE_LABEL: Record<string, string> = {
  SITE_VISIT: "Showing",
  MEETING: "Meeting",
  CALL: "Call",
  FOLLOW_UP: "Follow-up",
  OTHER: "Event",
};

function eventHref(ev: CalendarEventRow) {
  return ev.lead ? `/leads/${ev.lead.id}` : ev.opportunity ? `/opportunities/${ev.opportunity.id}` : null;
}

function EventRow({ ev, timeZone }: { ev: CalendarEventRow; timeZone: string }) {
  const href = eventHref(ev);
  const who = ev.lead ? `${ev.lead.firstName} ${ev.lead.lastName ?? ""}`.trim() : ev.opportunity?.name ?? null;
  const body = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{ev.title}</span>
        <Badge tone={ev.type === "SITE_VISIT" ? "accent" : "neutral"} className="gap-1">
          {ev.type === "SITE_VISIT" ? <MapPin className="h-3 w-3" /> : null}
          {TYPE_LABEL[ev.type] ?? ev.type.replaceAll("_", " ")}
        </Badge>
        {ev.status !== "SCHEDULED" ? <Badge tone="warning">{ev.status.replaceAll("_", " ")}</Badge> : null}
      </div>
      <div className="mt-1 text-xs text-muted">
        {formatDateTime(ev.startAt, timeZone)}
        {ev.location ? ` · ${ev.location}` : ""}
        {who ? ` · ${who}` : ""}
        {ev.owner?.name ? ` · ${ev.owner.name}` : ""}
      </div>
      {ev.notes ? <p className="mt-1 text-xs text-muted">{ev.notes}</p> : null}
    </>
  );
  return href ? (
    <Link href={href} className="block px-4 py-3 hover:bg-background">
      {body}
    </Link>
  ) : (
    <div className="px-4 py-3">{body}</div>
  );
}

function EventList({ events, nowIso, timeZone }: { events: CalendarEventRow[]; nowIso: string; timeZone: string }) {
  const now = new Date(nowIso).getTime();
  const upcoming = events.filter((e) => new Date(e.endAt).getTime() >= now && e.status === "SCHEDULED");
  const past = events.filter((e) => !upcoming.includes(e)).reverse();
  const dayKey = (iso: string) => formatDate(iso, timeZone);
  const todayKey = dayKey(nowIso);
  const groups = new Map<string, CalendarEventRow[]>();
  for (const e of upcoming) {
    const k = dayKey(e.startAt);
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  return (
    <div className="space-y-6">
      {upcoming.length === 0 ? (
        <div className="border border-border bg-surface px-4 py-8 text-center text-sm text-muted">
          Nothing coming up. Schedule a showing or a call to fill your calendar.
        </div>
      ) : (
        [...groups].map(([day, rows]) => (
          <section key={day} aria-label={day}>
            <h2 className="section-kicker mb-2">{day === todayKey ? `Today · ${day}` : day}</h2>
            <div className="divide-y divide-border border border-border bg-surface">
              {rows.map((ev) => (
                <EventRow key={ev.id} ev={ev} timeZone={timeZone} />
              ))}
            </div>
          </section>
        ))
      )}
      {past.length > 0 ? (
        <details>
          <summary className="section-kicker cursor-pointer">Earlier ({past.length})</summary>
          <div className="mt-2 divide-y divide-border border border-border bg-surface">
            {past.map((ev) => (
              <EventRow key={ev.id} ev={ev} timeZone={timeZone} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
