"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageHeader } from "@/components/page-header";
import { formatCurrency } from "@/lib/format";
import { RangeChips } from "@/components/editorial";

type Insights = {
  leadSources: Record<string, number>;
  conversionRates: { leadToConverted: number; opportunityWin: number };
  averageDealSize: number;
  salesCycleDays: number;
  stageConversion: Array<{ stage: string; count: number }>;
  pipelineAging: { d0_7: number; d8_14: number; d15_30: number; d31_60: number; d60p: number };
  whatsappResponseRate: number;
  activityVolume: number;
  totals: { leads: number; won: number; open: number };
  propertyMatchConversion: number;
};

const RANGES = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "90d", label: "90 days" },
  { id: "all", label: "All" },
];

function ChartTip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; name: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="border border-border bg-surface px-3 py-2 text-xs">
      <div className="meta">{label}</div>
      {payload.map((p) => (
        <div key={p.name}>
          {p.name}: {p.value}
        </div>
      ))}
    </div>
  );
}

export default function ReportsPage() {
  const [range, setRange] = useState("30d");
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    void fetch(`/api/insights?range=${range}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error ?? "Failed");
        setData(json.insights);
      })
      .catch((e: Error) => setError(e.message));
  }, [range]);

  const sources = useMemo(
    () =>
      Object.entries(data?.leadSources ?? {}).map(([name, count]) => ({
        name: name.replaceAll("_", " "),
        count,
      })),
    [data],
  );
  const aging = useMemo(
    () =>
      data
        ? [
            { name: "0–7", n: data.pipelineAging.d0_7 },
            { name: "8–14", n: data.pipelineAging.d8_14 },
            { name: "15–30", n: data.pipelineAging.d15_30 },
            { name: "31–60", n: data.pipelineAging.d31_60 },
            { name: "60+", n: data.pipelineAging.d60p },
          ]
        : [],
    [data],
  );

  return (
    <div className="page-in space-y-10 p-6 md:p-10">
      <PageHeader
        eyebrow="Reports"
        title="Revenue and conversion"
        description="Sales, pipeline, sources, WhatsApp, and property-match performance from live queries."
      />
      <RangeChips options={RANGES} value={range} onSelect={setRange} />
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {!data ? (
        <p className="text-sm text-muted">Loading report…</p>
      ) : (
        <>
          <section className="grid gap-8 sm:grid-cols-3">
            <div>
              <div className="section-kicker">Won deals</div>
              <div className="title mt-2">{data.totals.won}</div>
            </div>
            <div>
              <div className="section-kicker">Average deal</div>
              <div className="title money mt-2">{formatCurrency(data.averageDealSize)}</div>
            </div>
            <div>
              <div className="section-kicker">WhatsApp reply</div>
              <div className="title mt-2">{Math.round(data.whatsappResponseRate * 100)}%</div>
            </div>
          </section>
          <div className="hairline" />
          <section className="grid gap-12 lg:grid-cols-2">
            <div className="h-64">
              <div className="section-kicker mb-3">Lead sources</div>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sources}>
                  <CartesianGrid vertical={false} stroke="rgba(17,17,16,0.08)" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip content={<ChartTip />} />
                  <Bar dataKey="count" fill="#111110" maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="h-64">
              <div className="section-kicker mb-3">Pipeline aging</div>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={aging}>
                  <CartesianGrid vertical={false} stroke="rgba(17,17,16,0.08)" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip content={<ChartTip />} />
                  <Line type="monotone" dataKey="n" stroke="#0d9488" strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
          <section>
            <div className="section-kicker">Stage distribution</div>
            <div className="mt-4 divide-y divide-border">
              {data.stageConversion.map((s) => (
                <div key={s.stage} className="flex justify-between py-2 text-sm">
                  <span>{s.stage}</span>
                  <span className="mono">{s.count}</span>
                </div>
              ))}
            </div>
          </section>
          <p className="meta">
            Property match conversion {Math.round(data.propertyMatchConversion * 100)}% · activity volume{" "}
            {data.activityVolume} · cycle {Math.round(data.salesCycleDays)} days
          </p>
        </>
      )}
    </div>
  );
}
