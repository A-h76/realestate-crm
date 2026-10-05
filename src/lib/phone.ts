import { parsePhoneNumberWithError, type CountryCode } from "libphonenumber-js";

/**
 * Phone identity layer (US-01..US-05).
 *
 * Two separate concerns, deliberately not the same string:
 *  - **canonical identity** — E.164 (`+14155550123`). What we store, dedupe on, lock on,
 *    and hand to a provider as the send address.
 *  - **display** — national formatting for the workspace region (`(415) 555-0123`).
 *
 * Region is always explicit. A number is only canonicalized when the library can both parse
 * AND validate it for that region (or from its own `+` country code). Anything incomplete,
 * malformed or ambiguous returns null with a reason — it is never coerced into a wrong
 * country code. The old `normalizePkPhone` did the opposite: it prefixed a bare `+` to
 * leftover digits, turning `415-555-0123` into Swiss `+4155550123`.
 */

export const DEFAULT_REGION: CountryCode = "US";

export type PhoneRejection = "empty" | "too-short" | "not-a-number" | "invalid-for-region" | "unsupported-region";

export type PhoneParse =
  | { ok: true; e164: string; national: string; country: CountryCode | undefined }
  | { ok: false; reason: PhoneRejection };

/**
 * `+`-prefixed input carries its own country code and is parsed without a default region, so a
 * workspace in one country can still hold a correct foreign number. Everything else is
 * interpreted strictly as a `region` number.
 */
export function parsePhone(input: string | null | undefined, region: CountryCode = DEFAULT_REGION): PhoneParse {
  const raw = input?.trim();
  if (!raw) return { ok: false, reason: "empty" };

  // Letters are a sign this is not a phone number at all ("call me", "n/a"), but keep the
  // common separators and a vanity-free check: digits are what matters.
  const digitCount = (raw.match(/\d/g) ?? []).length;
  if (digitCount === 0) return { ok: false, reason: "not-a-number" };

  try {
    const parsed = raw.startsWith("+")
      ? parsePhoneNumberWithError(raw)
      : parsePhoneNumberWithError(raw, region);
    if (!parsed.isValid()) return { ok: false, reason: "invalid-for-region" };
    return { ok: true, e164: parsed.number, national: parsed.formatNational(), country: parsed.country };
  } catch (error) {
    const code = (error as { message?: string }).message ?? "";
    if (code === "TOO_SHORT") return { ok: false, reason: "too-short" };
    if (code === "INVALID_COUNTRY") return { ok: false, reason: "unsupported-region" };
    if (code === "TOO_LONG") return { ok: false, reason: "invalid-for-region" };
    return { ok: false, reason: digitCount < 7 ? "too-short" : "not-a-number" };
  }
}

/** Canonical E.164 identity, or null when the number is not a valid, complete number. */
export function canonicalPhone(input: string | null | undefined, region: CountryCode = DEFAULT_REGION): string | null {
  const parsed = parsePhone(input, region);
  return parsed.ok ? parsed.e164 : null;
}

export function isValidPhone(input: string | null | undefined, region: CountryCode = DEFAULT_REGION): boolean {
  return parsePhone(input, region).ok;
}

/**
 * User-facing form: national format for a number in `region`, international for anything else.
 * Falls back to the stored string so a legacy or unparseable value is shown as-is rather
 * than hidden behind a dash.
 */
export function formatPhone(input: string | null | undefined, region: CountryCode = DEFAULT_REGION): string {
  const raw = input?.trim();
  if (!raw) return "—";
  const parsed = parsePhone(raw, region);
  if (!parsed.ok) return raw;
  return parsed.country === region ? parsed.national : parsed.e164;
}

const REJECTION_MESSAGES: Record<PhoneRejection, string> = {
  empty: "Phone number is required",
  "too-short": "Phone number is incomplete",
  "not-a-number": "Not a recognizable phone number",
  "invalid-for-region": "Not a valid phone number for this region",
  "unsupported-region": "Unrecognized country code",
};

/** Import/validation error text for a rejected number. */
export function describePhoneRejection(reason: PhoneRejection): string {
  return REJECTION_MESSAGES[reason];
}
