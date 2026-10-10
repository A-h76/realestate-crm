import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { after, afterEach, before, beforeEach, describe, it, mock } from "node:test";
import { prisma } from "../../src/lib/db";
import { checkSheet, resetSheetsTokenCache } from "../../src/lib/crm/google-sheets";
import { CRM_MAX_ATTEMPTS, retryCrmSync, syncNewLead } from "../../src/lib/crm/sync";
import { ingestEnquiry } from "../../src/lib/intake/ingest";
import { createLead } from "../../src/lib/leads/create-lead";
import { leadCreateSchema } from "../../src/lib/validations/leads";
import { createTenant, destroyTenant, type Tenant } from "../helpers/http";

type Call = { method: string; url: string; headers: Record<string, string>; body: unknown };
const SHEET_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";

describe("Copying enquiries into the client's own CRM", () => {
  let tenant: Tenant;
  const calls: Call[] = [];
  /** contact lookup: id when the contact already exists in HubSpot, null = 404 */
  let existingContact: string | null = null;
  let hubspotCreateStatus = 201;
  let sheetsStatus = 200;
  let sheetHeaderRow: string[][] | undefined;
  const saved: Record<string, string | undefined> = {};
  const ENV = ["HUBSPOT_ACCESS_TOKEN", "GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", "AUTH_URL"];
  const uniq = () => randomUUID().slice(0, 8);
  let phoneSeq = 100; // a distinct valid number per lead, so none is flagged as a duplicate
  const nextPhone = () => `+1202555${String(phoneSeq++).padStart(4, "0")}`;
  const deliveries = () => prisma.crmSyncDelivery.findMany({ where: { workspaceId: tenant.workspaceId }, orderBy: { createdAt: "asc" } });
  const connect = (kind: "HUBSPOT" | "GOOGLE_SHEETS", target: string | null = null) =>
    prisma.crmConnection.create({ data: { workspaceId: tenant.workspaceId, kind, target } });
  const newLead = (extra: object = {}) =>
    createLead(tenant.workspaceId, tenant.users.OWNER.id, leadCreateSchema.parse({ firstName: "Sara", lastName: "Khan", email: `sara-${uniq()}@example.test`, phone: nextPhone(), notes: "Wants a quote", source: "WEB_FORM", ...extra }));
  const hubspotCalls = () => calls.filter((c) => c.url.startsWith("https://api.hubspot.com"));
  const sheetCalls = () => calls.filter((c) => c.url.startsWith("https://sheets.googleapis.com"));

  before(async () => {
    tenant = await createTenant("crm");
  });
  after(async () => {
    await destroyTenant(tenant);
  });
  beforeEach(async () => {
    for (const k of ENV) saved[k] = process.env[k];
    process.env.HUBSPOT_ACCESS_TOKEN = "pat-test";
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "sync@project.iam.gserviceaccount.com";
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString().replace(/\n/g, "\\n"); // as pasted into an env var
    process.env.AUTH_URL = "https://crm.acme.example";
    resetSheetsTokenCache();
    calls.length = 0;
    existingContact = null;
    hubspotCreateStatus = 201;
    sheetsStatus = 200;
    sheetHeaderRow = undefined;
    await prisma.crmSyncDelivery.deleteMany({ where: { workspaceId: tenant.workspaceId } });
    await prisma.crmConnection.deleteMany({ where: { workspaceId: tenant.workspaceId } });
    mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      const method = init.method ?? "GET";
      const raw = typeof init.body === "string" ? init.body : undefined;
      let body: unknown = raw;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        // form-encoded token request: keep the raw string
      }
      calls.push({ method, url: String(url), headers, body });
      const u = String(url);
      if (u.startsWith("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "g-token", expires_in: 3600 }), { status: 200 });
      if (u.startsWith("https://sheets.googleapis.com") && method === "GET") return new Response(JSON.stringify(sheetHeaderRow ? { values: sheetHeaderRow } : {}), { status: sheetsStatus });
      if (u.startsWith("https://sheets.googleapis.com")) return new Response("{}", { status: sheetsStatus });
      if (u.includes("/crm/v3/objects/contacts/") && method === "GET") return existingContact ? new Response(JSON.stringify({ id: existingContact }), { status: 200 }) : new Response("{}", { status: 404 });
      if (u.endsWith("/crm/v3/objects/contacts") && method === "POST") return new Response(JSON.stringify({ id: "501" }), { status: hubspotCreateStatus });
      return new Response(JSON.stringify({ id: "n1" }), { status: 201 });
    });
  });
  afterEach(() => {
    mock.restoreAll();
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  describe("HubSpot", () => {
    it("a new lead creates the contact (token in a header) and attaches the enquiry as a note", async () => {
      await connect("HUBSPOT");
      const lead = await newLead();
      const [create] = hubspotCalls().filter((c) => c.method === "POST" && c.url.endsWith("/contacts"));
      assert.equal(create.headers.Authorization, "Bearer pat-test");
      assert.deepEqual((create.body as { properties: Record<string, string> }).properties, {
        firstname: "Sara", lastname: "Khan", email: lead.email, phone: lead.phone, lifecyclestage: "lead", hs_lead_status: "NEW",
      });
      const note = hubspotCalls().find((c) => c.url.endsWith("/notes"))!.body as { properties: { hs_note_body: string }; associations: Array<{ to: { id: string }; types: Array<{ associationTypeId: number }> }> };
      assert.match(note.properties.hs_note_body, /Wants a quote/);
      assert.equal(note.associations[0].to.id, "501");
      assert.equal(note.associations[0].types[0].associationTypeId, 202);
      const [d] = await deliveries();
      assert.equal(d.status, "SENT");
      assert.equal(d.externalId, "501");
    });

    it("an email already in HubSpot is not overwritten: only a note is added to the existing contact", async () => {
      await connect("HUBSPOT");
      existingContact = "777";
      await newLead();
      assert.equal(hubspotCalls().filter((c) => c.method === "POST" && c.url.endsWith("/contacts")).length, 0);
      const note = hubspotCalls().find((c) => c.url.endsWith("/notes"))!.body as { associations: Array<{ to: { id: string } }> };
      assert.equal(note.associations[0].to.id, "777");
    });

    it("a repeat enquiry adds a second note, and replaying the same event copies nothing twice", async () => {
      await connect("HUBSPOT");
      const email = `again-${uniq()}@example.test`;
      const enquiry = { name: "Again Person", email, message: "First" };
      const first = await ingestEnquiry({ workspaceId: tenant.workspaceId, source: "WEB_FORM", sourceName: "Website form: x", enquiry });
      existingContact = "888";
      await ingestEnquiry({ workspaceId: tenant.workspaceId, source: "WEB_FORM", sourceName: "Website form: x", enquiry: { ...enquiry, message: "Second, still keen" } });
      const notes = hubspotCalls().filter((c) => c.url.endsWith("/notes")).map((c) => (c.body as { properties: { hs_note_body: string } }).properties.hs_note_body);
      assert.equal(notes.length, 2);
      assert.match(notes[1], /Enquired again: [\s\S]*Second, still keen/);
      const before = hubspotCalls().length;
      await syncNewLead(tenant.workspaceId, first.leadId!); // same event key as the first copy
      assert.equal(hubspotCalls().length, before);
    });

    it("a HubSpot outage never loses or blocks the lead; the retry job copies it once HubSpot is back", async () => {
      await connect("HUBSPOT");
      hubspotCreateStatus = 503;
      const lead = await newLead();
      assert.ok(await prisma.lead.findUnique({ where: { id: lead.id } }), "the lead is saved regardless");
      let [d] = await deliveries();
      assert.equal(d.status, "FAILED");
      assert.equal(d.attempts, 1);
      assert.equal(d.error, "HubSpot answered 503");

      assert.deepEqual(await retryCrmSync(), { sent: 0, failed: 0, gaveUp: 0 }, "too fresh to retry yet");
      await prisma.crmSyncDelivery.update({ where: { id: d.id }, data: { updatedAt: new Date(Date.now() - 10 * 60_000) } });
      hubspotCreateStatus = 201;
      assert.equal((await retryCrmSync()).sent, 1);
      [d] = await deliveries();
      assert.equal(d.status, "SENT");
    });

    it("a bad token is given up on at once and the owners are told once a day, not once per lead", async () => {
      await connect("HUBSPOT");
      hubspotCreateStatus = 401;
      const a = await newLead();
      await newLead();
      const rows = await deliveries();
      assert.deepEqual(rows.map((r) => r.status), ["GAVE_UP", "GAVE_UP"]);
      const told = await prisma.notification.findMany({ where: { workspaceId: tenant.workspaceId, type: "AUTOMATION_FAILED", userId: tenant.users.OWNER.id } });
      assert.equal(told.filter((n) => n.title.includes("HubSpot")).length, 1);
      assert.equal(a.id !== undefined, true);
    });

    it("gives up after the maximum number of attempts on a transient failure", async () => {
      await connect("HUBSPOT");
      hubspotCreateStatus = 503;
      await newLead();
      for (let i = 1; i < CRM_MAX_ATTEMPTS; i++) {
        await prisma.crmSyncDelivery.updateMany({ where: { workspaceId: tenant.workspaceId }, data: { updatedAt: new Date(Date.now() - 10 * 60_000) } });
        await retryCrmSync();
      }
      const [d] = await deliveries();
      assert.equal(d.status, "GAVE_UP");
      assert.equal(d.attempts, CRM_MAX_ATTEMPTS);
    });

    it("does nothing, and does not even look up connections, when the deployment has no credentials", async () => {
      await connect("HUBSPOT");
      delete process.env.HUBSPOT_ACCESS_TOKEN;
      delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
      await newLead();
      assert.equal((await deliveries()).length, 0);
      assert.equal(calls.length, 0);
    });
  });

  describe("Google Sheets", () => {
    it("appends a row to the right tab with a service-account token, and signs in only once", async () => {
      await connect("GOOGLE_SHEETS", `${SHEET_ID}|Leads 2026`);
      const lead = await newLead({ company: "Acme" });
      await newLead();
      const appends = sheetCalls().filter((c) => c.method === "POST");
      assert.equal(appends.length, 2);
      assert.ok(appends[0].url.includes(`/${SHEET_ID}/values/`));
      assert.ok(appends[0].url.includes(encodeURIComponent("'Leads 2026'!A:I")));
      assert.ok(appends[0].url.includes("valueInputOption=USER_ENTERED"));
      assert.equal(appends[0].headers.Authorization, "Bearer g-token");
      const row = (appends[0].body as { values: string[][] }).values[0];
      assert.deepEqual(row.slice(1), ["New enquiry", "Sara Khan", lead.email, `'${lead.phone}`, "Acme", "Website form", row[7], `https://crm.acme.example/leads/${lead.id}`]);
      assert.match(row[7], /Wants a quote/);
      assert.equal(calls.filter((c) => c.url.startsWith("https://oauth2.googleapis.com/token")).length, 1, "the token is cached");
    });

    it("a stranger cannot plant a spreadsheet formula through the public form", async () => {
      await connect("GOOGLE_SHEETS", SHEET_ID);
      await newLead({ firstName: '=HYPERLINK("http://evil.example","click")', lastName: undefined });
      const row = (sheetCalls().find((c) => c.method === "POST")!.body as { values: string[][] }).values[0];
      assert.ok(row[2].startsWith("'="), `formula neutralised, got ${row[2]}`);
    });

    it("a sheet that was never shared is given up on at once", async () => {
      await connect("GOOGLE_SHEETS", SHEET_ID);
      sheetsStatus = 403;
      await newLead();
      const [d] = await deliveries();
      assert.equal(d.status, "GAVE_UP");
      assert.equal(d.error, "Google Sheets answered 403");
    });

    it("connecting writes the header row only when the sheet is empty", async () => {
      assert.match(await checkSheet(SHEET_ID), /header row added/);
      const header = (sheetCalls().find((c) => c.method === "POST")!.body as { values: string[][] }).values[0];
      assert.deepEqual(header.slice(0, 3), ["Received", "Type", "Name"]);
      calls.length = 0;
      sheetHeaderRow = [["Received"]];
      assert.match(await checkSheet(SHEET_ID), /already has a header row/);
      assert.equal(sheetCalls().filter((c) => c.method === "POST").length, 0);
    });
  });
});
