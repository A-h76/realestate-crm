import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { logEvent } from "@/lib/log";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { clientIp } from "@/lib/security/request";
import { ingestEnquiry, type Enquiry } from "./ingest";

/**
 * Public website-form endpoint logic (POST /api/intake/forms/<publicKey>). The key identifies the form, it is not a
 * secret (it sits in the page's HTML). What keeps strangers out:
 *  - browsers must post from an origin on the form's allow-list (empty list = server-to-server posts only);
 *  - a hidden honeypot field, answered silently with "ok" so bots learn nothing;
 *  - per-IP and per-form rate limits, a 16KB body cap, and fixed field lengths;
 *  - the same answer for a new person and a known one, so the form never reveals who is already a lead.
 * ponytail: no CAPTCHA. Add Cloudflare Turnstile in front of this when a client's form starts attracting spam.
 */
export const MAX_FORM_BYTES = 16_384;
const HONEYPOT = "hp_url";
const MAPPED = new Set([HONEYPOT, "name", "full_name", "fullName", "first_name", "firstName", "last_name", "lastName", "email", "phone", "tel", "mobile", "company", "message", "enquiry", "comments"]);

const enquirySchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(120),
    email: z.string().trim().email("Enter a valid email").max(254).optional().or(z.literal("")),
    phone: z.string().trim().max(30).optional(),
    company: z.string().trim().max(120).optional(),
    message: z.string().trim().max(2000).optional(),
  })
  .refine((v) => Boolean(v.email) || Boolean(v.phone), { message: "Give an email or a phone number", path: ["email"] });

function flatten(contentType: string, text: string): Record<string, string> {
  if (contentType.includes("application/json")) {
    const data: unknown = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new ApiError(400, "Invalid body");
    return Object.fromEntries(Object.entries(data as Record<string, unknown>).filter(([, v]) => typeof v === "string" || typeof v === "number").map(([k, v]) => [k, String(v)]));
  }
  if (contentType.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(text));
  throw new ApiError(415, "Send JSON or a standard form post");
}

/** Maps common field names to an enquiry; anything else becomes a labelled extra answer. */
export function toEnquiry(raw: Record<string, string>): Enquiry {
  const pick = (...keys: string[]) => keys.map((k) => raw[k]).find((v) => v && v.trim());
  const first = pick("first_name", "firstName");
  const last = pick("last_name", "lastName");
  const parsed = enquirySchema.safeParse({
    name: pick("name", "full_name", "fullName") ?? [first, last].filter(Boolean).join(" "),
    email: pick("email") ?? "",
    phone: pick("phone", "tel", "mobile"),
    company: pick("company"),
    message: pick("message", "enquiry", "comments"),
  });
  if (!parsed.success) throw new ApiError(422, parsed.error.issues[0]?.message ?? "Invalid enquiry");
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (MAPPED.has(k) || !v.trim() || Object.keys(extra).length >= 10) continue;
    extra[k.replace(/[^\w .-]/g, "").slice(0, 40) || "field"] = v.trim().slice(0, 300);
  }
  return { ...parsed.data, email: parsed.data.email || null, extra };
}

function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  if (!origin || !allowed.includes(origin)) return {};
  return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600", Vary: "Origin" };
}

async function findForm(key: string) {
  return prisma.intakeSource.findFirst({
    where: { publicKey: key, kind: "WEB_FORM", enabled: true, workspace: { deletedAt: null } },
    select: { id: true, workspaceId: true, name: true, allowedOrigins: true },
  });
}

const THANKS_HTML = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Thank you</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>Thank you</h1><p>We have your enquiry and will be in touch shortly. You can close this page.</p>';

export async function preflight(request: Request, key: string): Promise<Response> {
  const form = await findForm(key);
  const headers = form ? corsHeaders(request.headers.get("origin"), form.allowedOrigins) : {};
  return new NextResponse(null, { status: Object.keys(headers).length ? 204 : 403, headers });
}

export async function submitWebForm(request: Request, key: string): Promise<Response> {
  let headers: Record<string, string> = {};
  try {
    await enforceRateLimit({ key: `intake:ip:${clientIp(request)}`, ...RATE_LIMITS.intakeIp }); // before the key lookup: no key probing
    const form = await findForm(key);
    if (!form) throw new ApiError(404, "Not found");
    const origin = request.headers.get("origin");
    if (origin) {
      headers = corsHeaders(origin, form.allowedOrigins);
      if (!headers["Access-Control-Allow-Origin"]) throw new ApiError(403, "This form is not enabled for this website");
    }
    await enforceRateLimit({ key: `intake:form:${form.id}`, ...RATE_LIMITS.intakeForm });

    const declared = Number(request.headers.get("content-length") ?? 0);
    const text = await request.text();
    if (declared > MAX_FORM_BYTES || text.length > MAX_FORM_BYTES) throw new ApiError(413, "Request body too large");
    const raw = flatten(request.headers.get("content-type") ?? "", text);

    const wantsPage = (request.headers.get("accept") ?? "").includes("text/html") && !(request.headers.get("content-type") ?? "").includes("json");
    const ok = () => (wantsPage ? new NextResponse(THANKS_HTML, { status: 200, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } }) : NextResponse.json({ ok: true }, { status: 200, headers }));
    if (raw[HONEYPOT]?.trim()) return ok(); // a bot filled the hidden field: pretend it worked, store nothing

    await ingestEnquiry({ workspaceId: form.workspaceId, source: "WEB_FORM", sourceName: `Website form: ${form.name}`, enquiry: toEnquiry(raw) });
    return ok();
  } catch (error) {
    if (error instanceof ApiError) return NextResponse.json({ error: error.message }, { status: error.status, headers: { ...headers, ...error.headers } });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers });
    logEvent("error", "intake_form_failed", { error });
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500, headers });
  }
}
