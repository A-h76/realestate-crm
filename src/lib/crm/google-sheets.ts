import { createSign } from "node:crypto";
import { sourceLabel } from "@/lib/dashboard-ui";
import { FETCH_TIMEOUTS_MS, fetchWithTimeout } from "@/lib/http";
import { CrmError, fullName, httpFailure, type SyncLead, type SyncPayload } from "./types";

/**
 * Appends one row per enquiry to the client's Google Sheet. Auth is a Google service account in the deployment's env
 * (GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY); the client shares their sheet with that email as
 * Editor. No Google SDK: a signed JWT is exchanged for a one-hour token (cached).
 * ponytail: at-least-once. If Google saves the row but the answer is lost, a retry appends it again; the Type/Received
 * columns make a duplicate obvious. Use a dedupe-id column if a client asks.
 */
export const SHEET_HEADERS = ["Received", "Type", "Name", "Email", "Phone", "Company", "Source", "Message", "Link"];
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export const sheetsConfigured = (env: NodeJS.ProcessEnv = process.env) => Boolean(env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);

let cached: { token: string; expiresAt: number } | null = null;
export const resetSheetsTokenCache = () => {
  cached = null;
};

const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64url");

async function accessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!email || !key) throw new CrmError("Google service account is not configured", true);
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({ iss: email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }))}`;
  let assertion: string;
  try {
    assertion = `${unsigned}.${b64url(createSign("RSA-SHA256").update(unsigned).sign(key))}`;
  } catch {
    throw new CrmError("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY is not a valid private key", true);
  }
  let res: Response;
  try {
    res = await fetchWithTimeout(TOKEN_URL, {
      provider: "google",
      timeoutMs: FETCH_TIMEOUTS_MS.whatsappGraph,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
    });
  } catch (e) {
    throw new CrmError(`Google unreachable: ${e instanceof Error ? e.name : "error"}`, false);
  }
  if (!res.ok) throw httpFailure("Google sign-in", res.status);
  const data = (await res.json()) as { access_token: string; expires_in?: number };
  cached = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return cached.token;
}

/** target is "<spreadsheetId>" or "<spreadsheetId>|<tab name>". */
function parseTarget(target: string | null): { id: string; tab: string | null } {
  const [id, tab] = (target ?? "").split("|");
  if (!id || !/^[\w-]{20,}$/.test(id)) throw new CrmError("The Google Sheet id is missing or malformed", true);
  return { id, tab: tab || null };
}

const rangeOf = (tab: string | null, cells: string) => (tab ? `'${tab.replace(/'/g, "''")}'!${cells}` : cells);

async function sheets(method: string, path: string, body?: unknown): Promise<Response> {
  const token = await accessToken();
  try {
    return await fetchWithTimeout(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
      provider: "google-sheets",
      timeoutMs: FETCH_TIMEOUTS_MS.whatsappGraph,
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (e) {
    throw new CrmError(`Google Sheets unreachable: ${e instanceof Error ? e.name : "error"}`, false);
  }
}

function append(target: string | null, row: string[]) {
  const { id, tab } = parseTarget(target);
  const range = encodeURIComponent(rangeOf(tab, "A:I"));
  return sheets("POST", `${id}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { values: [row] });
}

/**
 * A cell starting with = + - @ is read as a formula by USER_ENTERED; a public form must not be able to plant one. The
 * leading apostrophe is Sheets' text marker and is not displayed, which also keeps "+1202..." phone numbers as text.
 */
const safe = (v: string | null | undefined) => (v && /^[=+\-@]/.test(v) ? `'${v}` : (v ?? ""));

export async function pushToSheet(target: string | null, lead: SyncLead, payload: SyncPayload): Promise<string> {
  const base = (process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "");
  const message = payload.type === "again" ? payload.text : (lead.notes ?? "");
  const res = await append(target, [
    new Date().toISOString(),
    payload.type === "again" ? "Enquired again" : "New enquiry",
    safe(fullName(lead)),
    safe(lead.email),
    safe(lead.phone),
    safe(lead.company),
    sourceLabel(lead.source),
    safe(message.slice(0, 1500)),
    base ? `${base}/leads/${lead.id}` : "",
  ]);
  if (!res.ok) throw httpFailure("Google Sheets", res.status);
  return "row";
}

/** For `npm run crm -- connect-sheets`: proves access and writes the header row if the sheet is empty. */
export async function checkSheet(target: string | null): Promise<string> {
  const { id, tab } = parseTarget(target);
  const first = await sheets("GET", `${id}/values/${encodeURIComponent(rangeOf(tab, "A1:I1"))}`);
  if (!first.ok) throw httpFailure("Google Sheets", first.status);
  const rows = ((await first.json()) as { values?: string[][] }).values;
  if (rows?.length) return "Sheet is readable and already has a header row";
  const res = await append(target, SHEET_HEADERS);
  if (!res.ok) throw httpFailure("Google Sheets", res.status);
  return "Sheet is writable; header row added";
}
