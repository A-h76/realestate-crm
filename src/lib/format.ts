import { formatInTimeZone } from "date-fns-tz";

/**
 * US-market display formatting (US-07, US-08, US-13, US-14).
 *
 * Money goes through `Intl.NumberFormat` so the symbol, grouping and cents follow the
 * currency itself rather than a hardcoded prefix. Dates and times render in an explicit
 * IANA time zone — never the server's — in US order (MM/DD/YYYY) with 12-hour clock.
 *
 * `DEFAULT_TIMEZONE` is the fallback for call sites that have no workspace row loaded.
 * Anything rendering workspace-scoped data should pass that workspace's `timezone` so
 * dashboard roll-ups and their drill-downs cannot disagree.
 */

export const DEFAULT_TIMEZONE = process.env.DEFAULT_TIMEZONE?.trim() || "America/New_York";
export const DEFAULT_CURRENCY = "USD" as const;

export type SupportedCurrency = "USD";

const moneyFormatters = new Map<string, Intl.NumberFormat>();

function moneyFormatter(currency: string, fractionDigits: number): Intl.NumberFormat {
  const key = `${currency}:${fractionDigits}`;
  let formatter = moneyFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
    moneyFormatters.set(key, formatter);
  }
  return formatter;
}

function toNumber(amount: number | string | null | undefined): number | null {
  if (amount === null || amount === undefined || amount === "") return null;
  const value = typeof amount === "string" ? Number(amount) : amount;
  return Number.isFinite(value) ? value : null;
}

/** `$1,250,000` / `$1,250.50`. Null and unparseable amounts render as an em dash, never `$0`. */
export function formatMoney(
  amount: number | string | null | undefined,
  currency: string = DEFAULT_CURRENCY,
): string {
  const value = toNumber(amount);
  if (value === null) return "—";
  // Listing prices are whole dollars; show cents only when the amount actually has them.
  const hasCents = Math.abs(value % 1) > 0.0001;
  return moneyFormatter(currency, hasCents ? 2 : 0).format(value);
}

/** KPI-tile form: `$1.25M`, `$450K`. Falls back to the full format below $1,000. */
export function formatCompactMoney(
  amount: number | string | null | undefined,
  currency: string = DEFAULT_CURRENCY,
): string {
  const value = toNumber(amount);
  if (value === null) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${formatMoney(value / 1_000_000_000, currency)}B`.replace(/(\.\d*?)0+B$/, "$1B");
  if (abs >= 1_000_000) return `${moneyFormatter(currency, 2).format(value / 1_000_000)}M`;
  if (abs >= 1_000) return `${moneyFormatter(currency, 0).format(value / 1_000)}K`;
  return formatMoney(value, currency);
}

export function formatDate(date: Date | string | null | undefined, timeZone: string = DEFAULT_TIMEZONE): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "—";
  return formatInTimeZone(d, timeZone, "MM/dd/yyyy");
}

export function formatDateTime(date: Date | string | null | undefined, timeZone: string = DEFAULT_TIMEZONE): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "—";
  return formatInTimeZone(d, timeZone, "MM/dd/yyyy h:mm a");
}

export function formatTime(date: Date | string | null | undefined, timeZone: string = DEFAULT_TIMEZONE): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "—";
  return formatInTimeZone(d, timeZone, "h:mm a");
}

/** `2,400 sq ft` — US listings are square feet; acres are shown with 2 decimals. */
export function formatArea(
  size: number | string | null | undefined,
  unit: "SQFT" | "ACRE" | "SQM" | "OTHER" | null | undefined,
): string {
  const value = toNumber(size);
  if (value === null) return "—";
  const grouped = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: unit === "ACRE" ? 2 : 0,
  }).format(value);
  switch (unit) {
    case "ACRE":
      return `${grouped} ${value === 1 ? "acre" : "acres"}`;
    case "SQM":
      return `${grouped} m²`;
    case "SQFT":
      return `${grouped} sq ft`;
    default:
      return grouped;
  }
}

export function formatDeltaPct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function prettyRole(role?: string | null): string {
  if (!role) return "Team";
  return role
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
