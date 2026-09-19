"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCurrency } from "@/lib/format";

export type TrendPoint = { month: string; pipeline: number; weighted: number };
export type SourceSlice = { name: string; value: number; color: string };

function ChartTip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; name: string; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-[12px] border border-border bg-surface px-3 py-2 text-[12px] shadow-[var(--shadow)]">
      <div className="mb-1 font-medium">{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex justify-between gap-4">
          <span className="text-muted">{p.name}</span>
          <span className="money">{formatCurrency(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

function axisMoney(value: number) {
  if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(value) >= 1_000_000) return `${Math.round(value / 1_000_000)}M`;
  return String(value);
}

export function PipelineTrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={208}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="pipeFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#423A8E" stopOpacity={0.18} />
            <stop offset="100%" stopColor="#423A8E" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="#E5E7EB" />
        <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={axisMoney} tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} width={42} />
        <Tooltip content={<ChartTip />} />
        <Area type="monotone" dataKey="pipeline" name="Pipeline Value" stroke="#423A8E" strokeWidth={2} fill="url(#pipeFill)" />
        <Area type="monotone" dataKey="weighted" name="Weighted Value" stroke="#00DCCD" strokeWidth={2} fill="none" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function LeadsSourceDonut({ data, total }: { data: SourceSlice[]; total: number }) {
  return (
    <div className="relative h-full">
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={58} outerRadius={82} paddingAngle={2} stroke="none">
            {data.map((slice) => (
              <Cell key={slice.name} fill={slice.color} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value) => [String(value), "Leads"]}
            contentStyle={{ borderRadius: 12, borderColor: "#E5E7EB", fontSize: 12 }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-[22px] font-bold leading-none">{total}</div>
        <div className="mt-1 text-[11px] text-muted">Total Leads</div>
      </div>
    </div>
  );
}
