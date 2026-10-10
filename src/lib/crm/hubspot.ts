import { FETCH_TIMEOUTS_MS, fetchWithTimeout } from "@/lib/http";
import { CrmError, httpFailure, type SyncLead, type SyncPayload } from "./types";

/**
 * Copies an enquiry into the client's HubSpot: find the contact by email (create it if missing, never overwrite one
 * that exists) and attach the enquiry as a note on that contact. Auth is a HubSpot private-app token in the deployment's
 * env (HUBSPOT_ACCESS_TOKEN, scopes crm.objects.contacts.read/write; the note needs the same).
 * ponytail: a lead with no email cannot be matched, so it always creates a new contact; match on phone if clients ask.
 */
const API = "https://api.hubspot.com";
const NOTE_TO_CONTACT = 202; // HUBSPOT_DEFINED association type id, per HubSpot's notes guide

export const hubspotConfigured = (env: NodeJS.ProcessEnv = process.env) => Boolean(env.HUBSPOT_ACCESS_TOKEN);

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) throw new CrmError("HUBSPOT_ACCESS_TOKEN is not set", true);
  try {
    return await fetchWithTimeout(`${API}${path}`, {
      provider: "hubspot",
      timeoutMs: FETCH_TIMEOUTS_MS.whatsappGraph,
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (e) {
    throw new CrmError(`HubSpot unreachable: ${e instanceof Error ? e.name : "error"}`, false);
  }
}

async function findByEmail(email: string): Promise<string | null> {
  const res = await call("GET", `/crm/v3/objects/contacts/${encodeURIComponent(email)}?idProperty=email`);
  if (res.status === 404) return null;
  if (!res.ok) throw httpFailure("HubSpot", res.status);
  return String(((await res.json()) as { id: string }).id);
}

export async function pushToHubspot(lead: SyncLead, payload: SyncPayload): Promise<string> {
  let contactId = lead.email ? await findByEmail(lead.email) : null;
  if (!contactId) {
    const res = await call("POST", "/crm/v3/objects/contacts", {
      properties: {
        firstname: lead.firstName,
        ...(lead.lastName ? { lastname: lead.lastName } : {}),
        ...(lead.email ? { email: lead.email } : {}),
        ...(lead.phone ? { phone: lead.phone } : {}),
        ...(lead.company ? { company: lead.company } : {}),
        lifecyclestage: "lead",
        hs_lead_status: "NEW",
      },
    });
    if (res.status === 409 && lead.email) contactId = await findByEmail(lead.email); // created by someone else a moment ago
    else if (!res.ok) throw httpFailure("HubSpot", res.status);
    else contactId = String(((await res.json()) as { id: string }).id);
  }
  if (!contactId) throw new CrmError("HubSpot contact could not be found or created", false);

  const text = payload.type === "again" ? `Enquired again: ${payload.text}` : (lead.notes ?? "New enquiry");
  const note = await call("POST", "/crm/v3/objects/notes", {
    properties: { hs_timestamp: new Date().toISOString(), hs_note_body: text.slice(0, 60_000) },
    associations: [{ to: { id: contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: NOTE_TO_CONTACT }] }],
  });
  if (!note.ok) throw httpFailure("HubSpot", note.status);
  return contactId;
}

/** For `npm run crm -- test`: proves the token works without writing anything. */
export async function checkHubspot(): Promise<string> {
  const res = await call("GET", "/crm/v3/objects/contacts?limit=1");
  if (!res.ok) throw httpFailure("HubSpot", res.status);
  return "HubSpot token works (contacts readable)";
}
