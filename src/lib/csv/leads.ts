import { normalizePkPhone } from "@/lib/format";
import type { IntentType, LeadSource, PropertyPurpose, PropertyType } from "@prisma/client";
import { ApiError } from "@/lib/errors";

export const CSV_LIMITS = {
  maxBytes: 1_048_576,
  maxRows: 500,
  maxFieldLength: 2000,
} as const;

const SOURCES = new Set<LeadSource>([
  "ZAMEEN",
  "FACEBOOK_ADS",
  "REFERRAL",
  "WALK_IN",
  "SIGNBOARD",
  "WHATSAPP_INBOUND",
  "COLD_CALL",
  "EXISTING_CLIENT",
]);

const INTENTS = new Set<IntentType>(["BUY", "SELL", "RENT", "INVEST", "UNKNOWN"]);
const TYPES = new Set<PropertyType>(["PLOT", "HOUSE", "APARTMENT", "COMMERCIAL", "AGRICULTURAL"]);
const PURPOSES = new Set<PropertyPurpose>(["SALE", "RENT"]);

export type CsvLeadRow = {
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
  whatsappNumber?: string;
  source?: LeadSource;
  company?: string;
  industry?: string;
  preferredArea?: string;
  budgetMin?: number;
  budgetMax?: number;
  intentType?: IntentType;
  propertyTypePref?: PropertyType;
  propertyPurpose?: PropertyPurpose;
  notes?: string;
};

export type CsvIssue = { row: number; field: string; message: string };

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

export function parseCsv(text: string): string[][] {
  if (Buffer.byteLength(text, "utf8") > CSV_LIMITS.maxBytes) {
    throw new ApiError(413, "CSV exceeds the maximum size of 1MB");
  }
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map(splitCsvLine);
}

function readField(
  cells: string[],
  idx: (name: string) => number | undefined,
  key: string,
  row: number,
  invalid: CsvIssue[],
): string | null {
  const at = idx(key);
  const raw = at == null ? "" : (cells[at] ?? "").trim();
  if (raw.length > CSV_LIMITS.maxFieldLength) {
    invalid.push({
      row,
      field: key,
      message: `Field exceeds ${CSV_LIMITS.maxFieldLength} characters.`,
    });
    return null;
  }
  return raw;
}

function headerIndex(headers: string[]) {
  const map = new Map<string, number>();
  headers.forEach((h, i) => map.set(h.trim().toLowerCase().replace(/\s+/g, ""), i));
  return (name: string) => {
    const idx = map.get(name.toLowerCase().replace(/\s+/g, ""));
    return idx;
  };
}

export function parseLeadCsv(text: string): {
  valid: CsvLeadRow[];
  invalid: CsvIssue[];
  duplicatesInFile: number[];
} {
  const table = parseCsv(text);
  if (table.length < 2) {
    return { valid: [], invalid: [{ row: 1, field: "file", message: "CSV needs a header and at least one data row." }], duplicatesInFile: [] };
  }
  if (table.length - 1 > CSV_LIMITS.maxRows) {
    throw new ApiError(413, `CSV exceeds the maximum of ${CSV_LIMITS.maxRows} data rows`);
  }
  const idx = headerIndex(table[0]);
  const firstNameAt = idx("firstname");
  if (firstNameAt == null) {
    return { valid: [], invalid: [{ row: 1, field: "firstName", message: "Missing firstName column." }], duplicatesInFile: [] };
  }

  const valid: CsvLeadRow[] = [];
  const invalid: CsvIssue[] = [];
  const seen = new Map<string, number>();
  const duplicatesInFile: number[] = [];

  table.slice(1).forEach((cells, i) => {
    const row = i + 2;
    let overflow = false;
    const get = (key: string) => {
      const value = readField(cells, idx, key, row, invalid);
      if (value == null) {
        overflow = true;
        return "";
      }
      return value;
    };
    const firstName = get("firstname");
    if (overflow) return;
    if (!firstName) {
      invalid.push({ row, field: "firstName", message: "First name is required." });
      return;
    }
    const email = get("email") || undefined;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      invalid.push({ row, field: "email", message: "Invalid email." });
      return;
    }
    const sourceRaw = (get("source") || "WHATSAPP_INBOUND").toUpperCase().replace(/\s+/g, "_") as LeadSource;
    if (!SOURCES.has(sourceRaw)) {
      invalid.push({ row, field: "source", message: `Unknown source ${sourceRaw}.` });
      return;
    }
    const intentRaw = (get("intenttype") || get("intent") || "UNKNOWN").toUpperCase() as IntentType;
    if (!INTENTS.has(intentRaw)) {
      invalid.push({ row, field: "intentType", message: `Unknown intent ${intentRaw}.` });
      return;
    }
    const typeRaw = get("propertytypepref") || get("propertytype");
    const purposeRaw = get("propertypurpose") || get("purpose");
    if (typeRaw && !TYPES.has(typeRaw.toUpperCase() as PropertyType)) {
      invalid.push({ row, field: "propertyTypePref", message: `Unknown property type ${typeRaw}.` });
      return;
    }
    if (purposeRaw && !PURPOSES.has(purposeRaw.toUpperCase() as PropertyPurpose)) {
      invalid.push({ row, field: "propertyPurpose", message: `Unknown purpose ${purposeRaw}.` });
      return;
    }
    const phone = get("phone") ? normalizePkPhone(get("phone")) ?? get("phone") : undefined;
    const whatsappNumber = get("whatsappnumber") || get("whatsapp")
      ? normalizePkPhone(get("whatsappnumber") || get("whatsapp")) ?? undefined
      : phone;
    const budgetMin = get("budgetmin") ? Number(get("budgetmin")) : undefined;
    const budgetMax = get("budgetmax") ? Number(get("budgetmax")) : undefined;
    if (budgetMin != null && Number.isNaN(budgetMin)) {
      invalid.push({ row, field: "budgetMin", message: "budgetMin must be numeric." });
      return;
    }
    if (budgetMax != null && Number.isNaN(budgetMax)) {
      invalid.push({ row, field: "budgetMax", message: "budgetMax must be numeric." });
      return;
    }

    if (overflow) return;

    const key = (email || whatsappNumber || `${firstName}:${get("lastname")}`).toLowerCase();
    if (seen.has(key)) {
      duplicatesInFile.push(row);
      invalid.push({ row, field: "duplicate", message: `Duplicate of row ${seen.get(key)}.` });
      return;
    }
    seen.set(key, row);

    if (overflow) return;

    valid.push({
      firstName,
      lastName: get("lastname") || undefined,
      email,
      phone,
      whatsappNumber,
      source: sourceRaw,
      company: get("company") || undefined,
      industry: get("industry") || undefined,
      preferredArea: get("preferredarea") || get("area") || undefined,
      budgetMin,
      budgetMax,
      intentType: intentRaw,
      propertyTypePref: typeRaw ? (typeRaw.toUpperCase() as PropertyType) : undefined,
      propertyPurpose: purposeRaw ? (purposeRaw.toUpperCase() as PropertyPurpose) : undefined,
      notes: get("notes") || undefined,
    });
  });

  return { valid, invalid, duplicatesInFile };
}

export function escapeCsvCell(value: string | number | null | undefined): string {
  if (value == null) return "";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const s = String(value);
  const looksNumeric = /^-?\d+(\.\d+)?$/.test(s);
  const formulaLike = /^[=+\t\r@]/.test(s) || (s.startsWith("-") && !looksNumeric);
  const safe = formulaLike ? `'${s}` : s;
  if (/[",\n]/.test(safe)) return `"${safe.replaceAll('"', '""')}"`;
  return safe;
}

export function toCsv(rows: Array<Record<string, string | number | null | undefined>>) {
  if (rows.length === 0) return "\uFEFF";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(","), ...rows.map((row) => headers.map((header) => escapeCsvCell(row[header])).join(","))];
  return `\uFEFF${lines.join("\n")}`;
}
