"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Columns3,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { SourceName } from "@/components/source-name";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency, formatDatePK, formatDateTimePK } from "@/lib/format";
import { cn } from "@/lib/utils";

export type LeadRow = {
  id: string;
  firstName: string;
  lastName?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  source: string;
  industry?: string | null;
  leadScore: number;
  fitScore: number;
  intentScore: number;
  valueScore: number;
  stage: string;
  nextAction?: string | null;
  followUpDue?: string | null;
  lastActivityAt?: string | null;
  createdAt: string;
  estimatedValue?: string | number | null;
  owner?: { id: string; name: string } | null;
};

type SortKey =
  | "firstName"
  | "company"
  | "source"
  | "industry"
  | "leadScore"
  | "fitScore"
  | "intentScore"
  | "valueScore"
  | "stage"
  | "lastActivityAt"
  | "followUpDue"
  | "createdAt";

type ColumnKey =
  | "lead"
  | "company"
  | "source"
  | "industry"
  | "leadScore"
  | "fit"
  | "intent"
  | "valueScore"
  | "stage"
  | "owner"
  | "lastActivity"
  | "nextAction"
  | "followUp"
  | "created";

const ALL_COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: "lead", label: "Lead" },
  { key: "company", label: "Company" },
  { key: "source", label: "Source" },
  { key: "industry", label: "Industry" },
  { key: "leadScore", label: "Lead Score" },
  { key: "fit", label: "Fit" },
  { key: "intent", label: "Intent" },
  { key: "valueScore", label: "Value Score" },
  { key: "stage", label: "Stage" },
  { key: "owner", label: "Owner" },
  { key: "lastActivity", label: "Last Activity" },
  { key: "nextAction", label: "Next Action" },
  { key: "followUp", label: "Follow-up" },
  { key: "created", label: "Created" },
];

const STAGE_OPTIONS = [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "NURTURING",
  "CONVERTED",
  "LOST",
  "ARCHIVED",
];

const SOURCE_OPTIONS = [
  "ZAMEEN",
  "FACEBOOK_ADS",
  "REFERRAL",
  "WALK_IN",
  "SIGNBOARD",
  "WHATSAPP_INBOUND",
  "COLD_CALL",
  "EXISTING_CLIENT",
];

const PAGE_SIZE = 20;

function leadName(lead: LeadRow) {
  return `${lead.firstName} ${lead.lastName ?? ""}`.trim();
}

function stageTone(stage: string): "neutral" | "accent" | "warning" | "danger" | "success" {
  switch (stage) {
    case "NEW":
      return "accent";
    case "QUALIFIED":
    case "CONVERTED":
      return "success";
    case "LOST":
    case "ARCHIVED":
      return "danger";
    case "NURTURING":
      return "warning";
    default:
      return "neutral";
  }
}

function SortBtn({
  label,
  column,
  sortKey,
  sortDir,
  onSort,
}: {
  label: string;
  column: SortKey;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onSort: (column: SortKey) => void;
}) {
  const active = sortKey === column;
  return (
    <button
      type="button"
      onClick={() => onSort(column)}
      className="inline-flex items-center gap-1 text-left hover:text-foreground"
    >
      {label}
      {active ? (
        sortDir === "asc" ? (
          <ArrowUp className="h-3 w-3" />
        ) : (
          <ArrowDown className="h-3 w-3" />
        )
      ) : null}
    </button>
  );
}

export function LeadsTable({ initialLeads }: { initialLeads?: LeadRow[] }) {
  const [leads, setLeads] = useState<LeadRow[]>(initialLeads ?? []);
  const [loading, setLoading] = useState(!initialLeads);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("ALL");
  const [sourceFilter, setSourceFilter] = useState<string>("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [visible, setVisible] = useState<Record<ColumnKey, boolean>>(
    Object.fromEntries(ALL_COLUMNS.map((c) => [c.key, true])) as Record<ColumnKey, boolean>,
  );
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importReport, setImportReport] = useState<string | null>(null);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    company: "",
    email: "",
    phone: "",
    source: "WHATSAPP_INBOUND",
    industry: "",
    notes: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/leads?pageSize=100");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to load leads");
      }
      const data = await res.json();
      setLeads(Array.isArray(data) ? data : (data.items ?? data.leads ?? []));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load leads");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialLeads) void load();
  }, [initialLeads, load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = [...leads];
    if (stageFilter !== "ALL") rows = rows.filter((l) => l.stage === stageFilter);
    if (sourceFilter !== "ALL") rows = rows.filter((l) => l.source === sourceFilter);
    if (q) {
      rows = rows.filter((l) => {
        const hay = [
          leadName(l),
          l.company,
          l.email,
          l.phone,
          l.industry,
          l.source,
          l.stage,
          l.owner?.name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }

    rows.sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      const av = a[sortKey as keyof LeadRow];
      const bv = b[sortKey as keyof LeadRow];
      if (sortKey === "firstName") {
        return leadName(a).localeCompare(leadName(b)) * dir;
      }
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      const as = av == null ? "" : String(av);
      const bs = bv == null ? "" : String(bv);
      return as.localeCompare(bs) * dir;
    });

    return rows;
  }, [leads, search, stageFilter, sourceFilter, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [search, stageFilter, sourceFilter]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  async function createLead(e: React.FormEvent) {
    e.preventDefault();
    if (!form.firstName.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim() || undefined,
          company: form.company.trim() || undefined,
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
          source: form.source,
          industry: form.industry.trim() || undefined,
          notes: form.notes.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to create lead");
      setCreateOpen(false);
      setForm({
        firstName: "",
        lastName: "",
        company: "",
        email: "",
        phone: "",
        source: "WHATSAPP_INBOUND",
        industry: "",
        notes: "",
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create lead");
    } finally {
      setCreating(false);
    }
  }

  async function exportCsv() {
    setError(null);
    try {
      const res = await fetch("/api/leads/csv");
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "leads.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    }
  }

  async function importCsv(file: File) {
    setImporting(true);
    setImportReport(null);
    setError(null);
    try {
      const text = await file.text();
      const res = await fetch("/api/leads/csv", { method: "POST", body: text });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      setImportReport(
        `Imported ${data.created ?? 0}. Invalid ${data.invalid?.length ?? 0}. Duplicates ${data.duplicates?.length ?? 0}.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  async function softDelete(id: string) {
    if (!confirm("Archive this lead? (soft delete)")) return;
    setMenuId(null);
    try {
      const res = await fetch(`/api/leads/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to delete lead");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete lead");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            className="pl-9"
            placeholder="Search leads, company, phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="h-9 border border-border bg-surface px-3 text-sm"
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
        >
          <option value="ALL">All stages</option>
          {STAGE_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s.replaceAll("_", " ")}
            </option>
          ))}
        </select>
        <select
          className="h-9 border border-border bg-surface px-3 text-sm"
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
        >
          <option value="ALL">All sources</option>
          {SOURCE_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s.replaceAll("_", " ")}
            </option>
          ))}
        </select>
        <div className="relative">
          <Button type="button" variant="outline" size="sm" onClick={() => setColumnsOpen((o) => !o)}>
            <Columns3 className="h-4 w-4" />
            Columns
          </Button>
          {columnsOpen ? (
            <div className="absolute right-0 z-20 mt-1 w-52 border border-border bg-surface p-2 shadow-sm">
              {ALL_COLUMNS.map((col) => (
                <label key={col.key} className="flex items-center gap-2 px-2 py-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={visible[col.key]}
                    onChange={() =>
                      setVisible((v) => ({ ...v, [col.key]: !v[col.key] }))
                    }
                  />
                  {col.label}
                </label>
              ))}
            </div>
          ) : null}
        </div>
        <Button type="button" variant="accent" size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          New lead
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => void exportCsv()}>
          Export CSV
        </Button>
        <label className="inline-flex h-8 cursor-pointer items-center border border-border px-3 text-xs">
          {importing ? "Importing…" : "Import CSV"}
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            disabled={importing}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void importCsv(file);
            }}
          />
        </label>
      </div>

      {importReport ? <p className="text-xs text-muted">{importReport}</p> : null}

      {error ? (
        <div className="border border-danger/30 bg-red-50 px-3 py-2 text-sm text-danger">{error}</div>
      ) : null}

      <div className="overflow-x-auto border border-border bg-surface">
        <table className="ops w-full min-w-[1200px] text-left">
          <thead className="border-b border-border bg-background text-[11px] text-muted">
            <tr>
              {visible.lead ? (
                <th className="px-3 py-2">
                  <SortBtn label="Lead" column="firstName" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                </th>
              ) : null}
              {visible.company ? (
                <th className="px-3 py-2">
                  <SortBtn label="Company" column="company" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                </th>
              ) : null}
              {visible.source ? (
                <th className="px-3 py-2">
                  <SortBtn label="Source" column="source" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                </th>
              ) : null}
              {visible.industry ? (
                <th className="px-3 py-2">
                  <SortBtn label="Industry" column="industry" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                </th>
              ) : null}
              {visible.leadScore ? (
                <th className="px-3 py-2">
                  <SortBtn label="Lead Score" column="leadScore" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                </th>
              ) : null}
              {visible.fit ? (
                <th className="px-3 py-2">
                  <SortBtn label="Fit" column="fitScore" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                </th>
              ) : null}
              {visible.intent ? (
                <th className="px-3 py-2">
                  <SortBtn label="Intent" column="intentScore" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                </th>
              ) : null}
              {visible.valueScore ? (
                <th className="px-3 py-2">
                  <SortBtn label="Value Score" column="valueScore" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                </th>
              ) : null}
              {visible.stage ? (
                <th className="px-3 py-2">
                  <SortBtn label="Stage" column="stage" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                </th>
              ) : null}
              {visible.owner ? <th className="px-3 py-2">Owner</th> : null}
              {visible.lastActivity ? (
                <th className="px-3 py-2">
                  <SortBtn label="Last Activity" column="lastActivityAt" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                </th>
              ) : null}
              {visible.nextAction ? (
                <th className="px-3 py-2">Next Action</th>
              ) : null}
              {visible.followUp ? (
                <th className="px-3 py-2">
                  <SortBtn label="Follow-up" column="followUpDue" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                </th>
              ) : null}
              {visible.created ? (
                <th className="px-3 py-2">
                  <SortBtn label="Created" column="createdAt" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                </th>
              ) : null}
              <th className="px-3 py-2 w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr>
                <td colSpan={15} className="px-3 py-8 text-center text-muted">
                  Loading leads…
                </td>
              </tr>
            ) : pageRows.length === 0 ? (
              <tr>
                <td colSpan={15} className="px-3 py-8 text-center text-muted">
                  No leads match these filters. Adjust search or create a lead.
                </td>
              </tr>
            ) : (
              pageRows.map((lead) => (
                <tr key={lead.id} className="hover:bg-background/80">
                  {visible.lead ? (
                    <td className="px-3 py-2">
                      <Link href={`/leads/${lead.id}`} className="font-medium hover:text-accent">
                        {leadName(lead)}
                      </Link>
                      {lead.email ? (
                        <div className="text-xs text-muted">{lead.email}</div>
                      ) : null}
                    </td>
                  ) : null}
                  {visible.company ? (
                    <td className="px-3 py-2 text-muted">{lead.company ?? "—"}</td>
                  ) : null}
                  {visible.source ? (
                    <td className="px-3 py-2">
                      <SourceName source={lead.source} />
                    </td>
                  ) : null}
                  {visible.industry ? (
                    <td className="px-3 py-2 text-muted">{lead.industry ?? "—"}</td>
                  ) : null}
                  {visible.leadScore ? (
                    <td className="px-3 py-2 mono">{lead.leadScore}</td>
                  ) : null}
                  {visible.fit ? <td className="px-3 py-2 mono">{lead.fitScore}</td> : null}
                  {visible.intent ? (
                    <td className="px-3 py-2 mono">{lead.intentScore}</td>
                  ) : null}
                  {visible.valueScore ? (
                    <td className="px-3 py-2 mono">{lead.valueScore}</td>
                  ) : null}
                  {visible.stage ? (
                    <td className="px-3 py-2">
                      <Badge tone={stageTone(lead.stage)}>{lead.stage}</Badge>
                    </td>
                  ) : null}
                  {visible.owner ? (
                    <td className="px-3 py-2 text-muted">{lead.owner?.name ?? "—"}</td>
                  ) : null}
                  {visible.lastActivity ? (
                    <td className="px-3 py-2 mono text-[11px] text-muted">
                      {formatDateTimePK(lead.lastActivityAt)}
                    </td>
                  ) : null}
                  {visible.nextAction ? (
                    <td className="px-3 py-2 text-xs text-muted">{lead.nextAction ?? "—"}</td>
                  ) : null}
                  {visible.followUp ? (
                    <td className="px-3 py-2 mono text-[11px] text-muted">
                      {formatDatePK(lead.followUpDue)}
                    </td>
                  ) : null}
                  {visible.created ? (
                    <td className="px-3 py-2 mono text-[11px] text-muted">
                      {formatDatePK(lead.createdAt)}
                    </td>
                  ) : null}
                  <td className="relative px-3 py-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setMenuId((id) => (id === lead.id ? null : lead.id))}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                    {menuId === lead.id ? (
                      <div className="absolute right-3 z-10 mt-1 w-40 border border-border bg-surface py-1 shadow-sm">
                        <Link
                          href={`/leads/${lead.id}`}
                          className="block px-3 py-2 text-xs hover:bg-background"
                          onClick={() => setMenuId(null)}
                        >
                          Open
                        </Link>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-danger hover:bg-background"
                          onClick={() => void softDelete(lead.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Soft delete
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
        <span>
          {filtered.length} lead{filtered.length === 1 ? "" : "s"}
          {leadValueHint(pageRows)}
        </span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <span className="mono text-xs">
            {page} / {pageCount}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= pageCount}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          >
            Next
          </Button>
        </div>
      </div>

      {createOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg border border-border bg-surface shadow-lg">
            <div className="border-b border-border px-5 py-4">
              <h3 className="text-lg font-semibold">Create lead</h3>
              <p className="mt-1 text-xs text-muted">Posts to POST /api/leads</p>
            </div>
            <form onSubmit={(e) => void createLead(e)} className="space-y-3 p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="firstName">First name</Label>
                  <Input
                    id="firstName"
                    required
                    value={form.firstName}
                    onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lastName">Last name</Label>
                  <Input
                    id="lastName"
                    value={form.lastName}
                    onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="company">Company</Label>
                <Input
                  id="company"
                  value={form.company}
                  onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="source">Source</Label>
                  <select
                    id="source"
                    className="flex h-9 w-full border border-border bg-surface px-3 text-sm"
                    value={form.source}
                    onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
                  >
                    {SOURCE_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="industry">Industry</Label>
                  <Input
                    id="industry"
                    value={form.industry}
                    onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="accent" disabled={creating}>
                  {creating ? "Creating…" : "Create lead"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function leadValueHint(rows: LeadRow[]) {
  if (rows.length === 0) return null;
  const total = rows.reduce((sum, l) => sum + Number(l.estimatedValue ?? 0), 0);
  if (!total) return null;
  return (
    <span className={cn("ml-2 text-xs")}>
      · page est. {formatCurrency(total)}
    </span>
  );
}
