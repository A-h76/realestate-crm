import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { FETCH_TIMEOUTS_MS, fetchWithTimeout } from "@/lib/http";
import { logEvent } from "@/lib/log";
import { verifyHubSignature256 } from "@/lib/security/hmac";
import { ingestEnquiry, type Enquiry } from "@/lib/intake/ingest";

/**
 * Meta (Facebook / Instagram) lead-ads webhook. Meta sends only an id ("leadgen_id"); the person's answers are fetched
 * from the Graph API with the Page access token. Per-deployment env: META_APP_SECRET (signature), META_VERIFY_TOKEN
 * (subscribe handshake), META_PAGE_ACCESS_TOKEN (Graph read), optional META_GRAPH_API_VERSION. Which workspace a Page
 * belongs to is an IntakeSource row of kind META_LEADS (externalId = Page id), created by the operator.
 *
 * Re-deliveries are harmless: the leadgen id is claimed in the same transaction as the lead (see ingestEnquiry). If the
 * Graph fetch fails we answer 5xx so Meta retries; leads already saved in the same delivery are not duplicated.
 */
type LeadgenChange = { field?: string; value?: { leadgen_id?: string | number; page_id?: string | number; form_id?: string | number } };
type Payload = { object?: string; entry?: Array<{ id?: string | number; changes?: LeadgenChange[] }> };
type GraphLead = { field_data?: Array<{ name?: string; values?: string[] }> };

export type MetaWebhookResult = { status: "ok" | "ignored"; created: number; repeat: number; duplicates: number; ignored: number };

async function fetchLead(leadgenId: string): Promise<GraphLead> {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!token) throw new ApiError(503, "Meta lead ads are not configured");
  const version = process.env.META_GRAPH_API_VERSION || process.env.WHATSAPP_GRAPH_API_VERSION || "v21.0";
  const res = await fetchWithTimeout(`https://graph.facebook.com/${version}/${leadgenId}?fields=field_data`, {
    provider: "meta-graph",
    timeoutMs: FETCH_TIMEOUTS_MS.whatsappGraph,
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    logEvent("warn", "meta_lead_fetch_failed", { httpStatus: res.status });
    throw new ApiError(502, "Could not read the lead from Meta");
  }
  return (await res.json()) as GraphLead;
}

const label = (name: string) => name.replace(/_/g, " ").trim().slice(0, 40) || "field";

/** Meta's standard question names first; any custom question becomes a labelled extra answer. */
export function metaFieldsToEnquiry(fieldData: GraphLead["field_data"]): Enquiry {
  const answers = new Map<string, string>();
  for (const f of fieldData ?? []) if (f.name && f.values?.[0]?.trim()) answers.set(f.name, f.values[0].trim());
  const take = (...names: string[]) => {
    for (const n of names) {
      const v = answers.get(n);
      if (v !== undefined) return v;
    }
    return undefined;
  };
  const name = take("full_name") ?? [take("first_name"), take("last_name")].filter(Boolean).join(" ");
  const used = new Set(["full_name", "first_name", "last_name", "email", "phone_number", "phone", "company_name"]);
  const extra: Record<string, string> = {};
  for (const [k, v] of answers) if (!used.has(k) && Object.keys(extra).length < 10) extra[label(k)] = v.slice(0, 300);
  return {
    name: name || "Facebook lead",
    email: take("email") ?? null,
    phone: take("phone_number", "phone") ?? null,
    company: take("company_name") ?? null,
    extra,
  };
}

export async function processMetaLeadsWebhook(rawBody: string, signature: string | null): Promise<MetaWebhookResult> {
  const secret = process.env.META_APP_SECRET;
  if (!secret) throw new ApiError(503, "Meta lead ads are not configured");
  if (!verifyHubSignature256(rawBody, signature, secret)) throw new ApiError(401, "Invalid signature");

  let payload: Payload;
  try {
    payload = JSON.parse(rawBody) as Payload;
  } catch {
    throw new ApiError(400, "Invalid JSON");
  }
  const result: MetaWebhookResult = { status: "ignored", created: 0, repeat: 0, duplicates: 0, ignored: 0 };
  if (payload.object !== "page") return result;

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const leadgenId = String(change.value?.leadgen_id ?? "");
      if (change.field !== "leadgen" || !/^\d{5,30}$/.test(leadgenId)) {
        result.ignored += 1;
        continue;
      }
      const pageId = String(change.value?.page_id ?? entry.id ?? "");
      const source = await prisma.intakeSource.findFirst({
        where: { kind: "META_LEADS", externalId: pageId, enabled: true, workspace: { deletedAt: null } },
        select: { workspaceId: true, name: true },
      });
      if (!source) {
        logEvent("warn", "meta_lead_unknown_page", { pageId });
        result.ignored += 1;
        continue;
      }
      const lead = await fetchLead(leadgenId);
      const out = await ingestEnquiry({
        workspaceId: source.workspaceId,
        source: "FACEBOOK_ADS",
        sourceName: `Facebook lead form: ${source.name}`,
        enquiry: metaFieldsToEnquiry(lead.field_data),
        event: { provider: "meta-leadgen", externalEventId: leadgenId },
      });
      if (out.outcome === "created") result.created += 1;
      else if (out.outcome === "repeat") result.repeat += 1;
      else result.duplicates += 1;
    }
  }
  result.status = "ok";
  return result;
}
