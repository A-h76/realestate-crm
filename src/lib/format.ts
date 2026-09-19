import { formatInTimeZone } from "date-fns-tz";

const KARACHI = "Asia/Karachi";

function groupThousands(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? "-" : "";
  const digits = String(Math.abs(rounded));
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${grouped}`;
}

export function formatPKR(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined) return "Rs —";
  const value = typeof amount === "string" ? Number(amount) : amount;
  if (Number.isNaN(value)) return "Rs —";
  return `Rs ${groupThousands(value)}`;
}

export function formatCurrency(
  amount: number | string | null | undefined,
  currency: "PKR" | "USD" = "PKR",
): string {
  if (currency === "USD") {
    const value = typeof amount === "string" ? Number(amount) : Number(amount ?? 0);
    return `$ ${groupThousands(value)}`;
  }
  return formatPKR(amount);
}

export function formatDatePK(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return formatInTimeZone(d, KARACHI, "dd/MM/yyyy");
}

export function formatDateTimePK(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return formatInTimeZone(d, KARACHI, "dd/MM/yyyy HH:mm");
}

export function formatTimePK(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return formatInTimeZone(d, KARACHI, "HH:mm");
}

/** Normalize Pakistani phone / WhatsApp numbers toward +92XXXXXXXXXX */
export function normalizePkPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/[^\d+]/g, "");
  if (digits.startsWith("+92") && digits.length === 13) return digits;
  if (digits.startsWith("92") && digits.length === 12) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 11) return `+92${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith("3")) return `+92${digits}`;
  return digits.startsWith("+") ? digits : `+${digits}`;
}

export function isValidPkPhone(input: string | null | undefined): boolean {
  const normalized = normalizePkPhone(input);
  return Boolean(normalized && /^\+92\d{10}$/.test(normalized));
}

export function formatCompactPKR(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined) return "Rs —";
  const value = typeof amount === "string" ? Number(amount) : amount;
  if (Number.isNaN(value)) return "Rs —";
  if (Math.abs(value) >= 1_000_000_000) return `Rs ${(value / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(value) >= 1_000_000) return `Rs ${Math.round(value / 1_000_000)}M`;
  return formatPKR(value);
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
