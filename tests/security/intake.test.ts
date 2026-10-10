import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { after, afterEach, before, beforeEach, describe, it, mock } from "node:test";
import { prisma } from "../../src/lib/db";
import { recordConsent } from "../../src/lib/messaging/consent";
import { loadSourceCoverage } from "../../src/lib/sources/coverage";
import { createTenant, destroyTenant, freshIp, type Tenant } from "../helpers/http";

type Handler = (request: Request, context: { params: Promise<{ key: string }> }) => Response | Promise<Response>;
let FORM_POST: Handler;
let FORM_OPTIONS: Handler;
let META_POST: (request: Request) => Promise<Response>;
let META_GET: (request: Request) => Promise<Response>;
let RESEND_POST: (request: Request) => Promise<Response>;

const SECRET = "meta-app-secret-for-tests";
const ORIGIN = "https://shop.example";
const sign = (raw: string) => `sha256=${createHmac("sha256", SECRET).update(raw, "utf8").digest("hex")}`;

describe("Public intake: website form and Meta lead ads", () => {
  let tenant: Tenant;
  let formKey: string;
  const outbound: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> = [];
  let graphStatus = 200;
  let receivedStatus = 200;
  let received: { text?: string; subject?: string; headers?: Record<string, string> } = {};
  let graphFields: Array<{ name: string; values: string[] }> = [];
  const saved: Record<string, string | undefined> = {};
  const ENV = ["RESEND_API_KEY", "ALERT_FROM_EMAIL", "META_APP_SECRET", "META_VERIFY_TOKEN", "META_PAGE_ACCESS_TOKEN", "AUTH_URL", "ENQUIRY_REPLY_TO", "RESEND_WEBHOOK_SECRET"];

  const form = (body: unknown, init: { origin?: string; contentType?: string; accept?: string } = {}) =>
    new Request(`http://localhost/api/intake/forms/${formKey}`, {
      method: "POST",
      headers: {
        "content-type": init.contentType ?? "application/json",
        ...(init.origin ? { origin: init.origin } : {}),
        ...(init.accept ? { accept: init.accept } : {}),
        ...freshIp(),
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  const post = (body: unknown, init?: Parameters<typeof form>[1], key = formKey) => FORM_POST(form(body, init), { params: Promise.resolve({ key }) });
  const leads = (where: object = {}) => prisma.lead.findMany({ where: { workspaceId: tenant.workspaceId, ...where }, orderBy: { createdAt: "asc" } });
  const uniq = () => randomUUID().slice(0, 8);

  before(async () => {
    ({ POST: FORM_POST, OPTIONS: FORM_OPTIONS } = await import("../../src/app/api/intake/forms/[key]/route"));
    ({ POST: META_POST, GET: META_GET } = (await import("../../src/app/api/webhooks/meta/route")) as never);
    ({ POST: RESEND_POST } = (await import("../../src/app/api/webhooks/resend/route")) as never);
    tenant = await createTenant("intake");
    formKey = `key-${randomUUID()}`;
    await prisma.intakeSource.create({ data: { workspaceId: tenant.workspaceId, kind: "WEB_FORM", name: "Contact page", publicKey: formKey, allowedOrigins: [ORIGIN] } });
  });
  after(async () => {
    await destroyTenant(tenant);
  });
  beforeEach(() => {
    for (const k of ENV) saved[k] = process.env[k];
    for (const k of ENV) delete process.env[k];
    outbound.length = 0;
    graphStatus = 200;
    receivedStatus = 200;
    mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
      if (String(url).startsWith("https://api.resend.com/emails/receiving/")) {
        outbound.push({ url: String(url), body: {}, headers: init.headers as Record<string, string> });
        return new Response(JSON.stringify(received), { status: receivedStatus });
      }
      if (String(url).startsWith("https://graph.facebook.com/")) {
        outbound.push({ url: String(url), body: {}, headers: init.headers as Record<string, string> });
        return graphStatus === 200 ? new Response(JSON.stringify({ field_data: graphFields }), { status: 200 }) : new Response("{}", { status: graphStatus });
      }
      outbound.push({ url: String(url), body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
      return new Response("{}", { status: 200 });
    });
  });
  afterEach(() => {
    mock.restoreAll();
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  describe("website form", () => {
    it("creates a WEB_FORM lead with an owner, the message and extra answers, and audits the channel", async () => {
      const email = `sara-${uniq()}@example.test`;
      const res = await post({ name: "Sara Khan", email, phone: "(202) 555-0143", message: "Need a quote", service: "Whitening" }, { origin: ORIGIN });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("access-control-allow-origin"), ORIGIN);
      const [lead] = await leads({ email });
      assert.equal(lead.source, "WEB_FORM");
      assert.equal(lead.firstName, "Sara");
      assert.equal(lead.lastName, "Khan");
      assert.ok(lead.ownerId, "every lead leaves intake owned");
      assert.match(lead.notes ?? "", /Via Website form: Contact page/);
      assert.match(lead.notes ?? "", /Need a quote/);
      assert.match(lead.notes ?? "", /service: Whitening/);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { workspaceId: tenant.workspaceId, action: "LEAD_CREATED", entityId: lead.id } });
      assert.equal((audit.metadata as { intake?: string }).intake, "Website form: Contact page");
      assert.equal(lead.firstContactAt, null);
    });

    it("rejects a browser origin that is not on the allow-list, and creates nothing", async () => {
      const email = `evil-${uniq()}@example.test`;
      const res = await post({ name: "Eve", email }, { origin: "https://evil.example" });
      assert.equal(res.status, 403);
      assert.equal(res.headers.get("access-control-allow-origin"), null);
      assert.equal((await leads({ email })).length, 0);
    });

    it("answers the CORS preflight for an allowed origin only", async () => {
      const preflight = (origin: string) =>
        FORM_OPTIONS(new Request("http://localhost/x", { method: "OPTIONS", headers: { origin } }), { params: Promise.resolve({ key: formKey }) });
      const ok = await preflight(ORIGIN);
      assert.equal(ok.status, 204);
      assert.equal(ok.headers.get("access-control-allow-origin"), ORIGIN);
      assert.equal((await preflight("https://evil.example")).status, 403);
    });

    it("an unknown key is a 404", async () => {
      assert.equal((await post({ name: "X", email: "x@example.test" }, {}, "no-such-key")).status, 404);
    });

    it("a filled honeypot looks like success but stores nothing", async () => {
      const email = `bot-${uniq()}@example.test`;
      const res = await post({ name: "Bot", email, hp_url: "http://spam.example" });
      assert.equal(res.status, 200);
      assert.equal((await leads({ email })).length, 0);
    });

    it("needs a name and an email or phone; refuses oversize bodies and unknown content types", async () => {
      assert.equal((await post({ name: "No Contact" })).status, 422);
      assert.equal((await post({ email: "a@example.test" })).status, 422);
      assert.equal((await post({ name: "Big", email: "big@example.test", message: "x".repeat(3000) })).status, 422);
      assert.equal((await post(JSON.stringify({ name: "Huge", email: "h@example.test", message: "x".repeat(20_000) }))).status, 413);
      assert.equal((await post("name=A", { contentType: "text/plain" })).status, 415);
    });

    it("a plain HTML form post works and gets a thank-you page", async () => {
      const email = `plain-${uniq()}@example.test`;
      const res = await post(`name=Plain+Person&email=${encodeURIComponent(email)}&message=Hi`, { contentType: "application/x-www-form-urlencoded", accept: "text/html", origin: ORIGIN });
      assert.equal(res.status, 200);
      assert.match(await res.text(), /Thank you/);
      assert.equal((await leads({ email })).length, 1);
    });

    it("the same person enquiring again adds a note and tells the owner instead of making a second lead", async () => {
      const email = `again-${uniq()}@example.test`;
      await post({ name: "Again Person", email, message: "First message" });
      const res = await post({ name: "Again Person", email, message: "Second message, still interested" });
      assert.equal(res.status, 200, "same answer as a new person: the form never reveals who is known");
      const found = await leads({ email });
      assert.equal(found.length, 1);
      const notes = await prisma.note.findMany({ where: { leadId: found[0].id } });
      assert.equal(notes.length, 1);
      assert.match(notes[0].body, /Second message/);
      const owner = await prisma.notification.findMany({ where: { workspaceId: tenant.workspaceId, entityId: found[0].id, type: "ENQUIRY_RECEIVED" } });
      assert.equal(owner.length, 1);
      assert.equal(owner[0].userId, found[0].ownerId);
    });

    it("emails the enquirer an instant reply (no first-contact stamp) and alerts the team, once", async () => {
      process.env.RESEND_API_KEY = "re_test";
      process.env.ALERT_FROM_EMAIL = "Acme <alerts@acme.example>";
      process.env.ENQUIRY_REPLY_TO = "front-desk@shop.example";
      await prisma.alertContact.create({ data: { workspaceId: tenant.workspaceId, address: "boss@shop.example" } });
      const email = `ack-${uniq()}@example.test`;
      await post({ name: "Ack Person", email });
      const sentTo = outbound.map((o) => (o.body.to as string[] | undefined)?.[0]).sort();
      assert.deepEqual(sentTo, ["boss@shop.example", email].sort());
      const ack = outbound.find((o) => (o.body.to as string[])[0] === email)!;
      assert.equal(ack.body.reply_to, "front-desk@shop.example");
      assert.match(String(ack.body.text), /Hi Ack,/);
      const [lead] = await leads({ email });
      assert.equal(lead.firstContactAt, null, "an auto-reply is not a human answering");
      const activity = await prisma.activity.findFirstOrThrow({ where: { leadId: lead.id, type: "SYSTEM" } });
      assert.equal((activity.metadata as { template?: string }).template, "enquiry_ack");
      await prisma.alertContact.deleteMany({ where: { workspaceId: tenant.workspaceId } });
    });

    it("never emails the instant reply to someone who opted out", async () => {
      process.env.RESEND_API_KEY = "re_test";
      process.env.ALERT_FROM_EMAIL = "Acme <alerts@acme.example>";
      const email = `stop-${uniq()}@example.test`;
      await recordConsent({ workspaceId: tenant.workspaceId, channel: "EMAIL", rawAddress: email, status: "REVOKED", source: "test" });
      await post({ name: "Opted Out", email });
      assert.equal(outbound.length, 0);
      assert.equal((await leads({ email })).length, 1, "the enquiry itself is still captured");
    });
  });

  describe("Meta lead ads", () => {
    const PAGE = "1234567890123";
    const body = (leadgenId: string, pageId = PAGE) =>
      JSON.stringify({ object: "page", entry: [{ id: pageId, changes: [{ field: "leadgen", value: { leadgen_id: leadgenId, page_id: pageId, form_id: "99" } }] }] });
    const deliver = (raw: string, signature: string | null = sign(raw)) =>
      META_POST(new Request("http://localhost/api/webhooks/meta", { method: "POST", headers: { "x-hub-signature-256": signature ?? "", ...freshIp() }, body: raw }));

    before(async () => {
      await prisma.intakeSource.create({ data: { workspaceId: tenant.workspaceId, kind: "META_LEADS", name: "Spring promo", externalId: PAGE, publicKey: `meta-${randomUUID()}`, allowedOrigins: [] } });
    });
    beforeEach(() => {
      process.env.META_APP_SECRET = SECRET;
      process.env.META_VERIFY_TOKEN = "verify-me";
      process.env.META_PAGE_ACCESS_TOKEN = "page-token";
    });

    it("answers the subscribe handshake only with the right token", async () => {
      const handshake = (token: string) => META_GET(new Request(`http://localhost/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=abc123`));
      const good = await handshake("verify-me");
      assert.equal(good.status, 200);
      assert.equal(await good.text(), "abc123");
      assert.equal((await handshake("wrong")).status, 403);
    });

    it("rejects an unsigned or wrongly signed delivery and an unconfigured deployment", async () => {
      const raw = body("100000000000001");
      assert.equal((await deliver(raw, "sha256=deadbeef")).status, 401);
      assert.equal((await deliver(raw, null)).status, 401);
      delete process.env.META_APP_SECRET;
      assert.equal((await deliver(raw)).status, 503);
      assert.equal(outbound.length, 0, "nothing is fetched for an unauthenticated delivery");
    });

    it("fetches the lead answers, creates a FACEBOOK_ADS lead, and ignores a re-delivery", async () => {
      const email = `fb-${uniq()}@example.test`;
      graphFields = [
        { name: "full_name", values: ["Fatima Ali"] },
        { name: "email", values: [email] },
        { name: "phone_number", values: ["+12025550177"] },
        { name: "which_service", values: ["Teeth whitening"] },
      ];
      const raw = body("100000000000002");
      const first = await deliver(raw);
      assert.equal(first.status, 200);
      assert.equal(((await first.json()) as { created: number }).created, 1);
      assert.equal(outbound[0].headers.Authorization, "Bearer page-token", "token goes in a header, never in the URL");
      assert.ok(!outbound[0].url.includes("page-token"));
      const [lead] = await leads({ email });
      assert.equal(lead.source, "FACEBOOK_ADS");
      assert.equal(lead.firstName, "Fatima");
      assert.match(lead.notes ?? "", /which service: Teeth whitening/);

      const again = await deliver(raw);
      assert.equal(((await again.json()) as { duplicates: number }).duplicates, 1);
      assert.equal((await leads({ email })).length, 1);
    });

    it("a Graph failure answers 5xx so Meta retries, and the retry then creates exactly one lead", async () => {
      const email = `retry-${uniq()}@example.test`;
      graphFields = [{ name: "full_name", values: ["Retry Person"] }, { name: "email", values: [email] }];
      const raw = body("100000000000003");
      graphStatus = 500;
      assert.equal((await deliver(raw)).status, 502);
      assert.equal((await leads({ email })).length, 0);
      graphStatus = 200;
      assert.equal((await deliver(raw)).status, 200);
      assert.equal((await leads({ email })).length, 1);
    });

    it("a page nobody registered is ignored, not an error", async () => {
      const res = await deliver(body("100000000000004", "999999999999999"));
      assert.equal(res.status, 200);
      assert.equal(((await res.json()) as { ignored: number }).ignored, 1);
      assert.ok(!outbound.some((o) => o.url.startsWith("https://graph.facebook.com/")), "no Graph call for an unknown page");
    });
  });

  describe("Inbound email (Resend)", () => {
    const MAILBOX = `enquiries-${randomUUID().slice(0, 6)}@inbound.example`;
    const WHSEC = `whsec_${Buffer.from("inbound-email-test-secret").toString("base64")}`;
    const event = (emailId: string, from: string, to = MAILBOX) =>
      JSON.stringify({ type: "email.received", created_at: new Date().toISOString(), data: { email_id: emailId, from, to: [to], subject: "Hello", received_for: [to] } });
    const deliver = (raw: string, secret = WHSEC) => {
      const id = `msg_${randomUUID()}`;
      const timestamp = String(Math.floor(Date.now() / 1000));
      const sig = createHmac("sha256", Buffer.from(secret.replace(/^whsec_/, ""), "base64")).update(`${id}.${timestamp}.${raw}`, "utf8").digest("base64");
      return RESEND_POST(new Request("http://localhost/api/webhooks/resend", { method: "POST", headers: { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${sig}`, ...freshIp() }, body: raw }));
    };
    const fetchedBodies = () => outbound.filter((o) => o.url.includes("/emails/receiving/"));
    const eid = () => `em-${randomUUID()}`;

    before(async () => {
      await prisma.intakeSource.create({ data: { workspaceId: tenant.workspaceId, kind: "EMAIL", name: "Info mailbox", externalId: MAILBOX, publicKey: `mail-${randomUUID()}`, allowedOrigins: [] } });
    });
    beforeEach(() => {
      process.env.RESEND_WEBHOOK_SECRET = WHSEC;
      process.env.RESEND_API_KEY = "re_test";
      received = { text: "Do you have an opening on Friday?", subject: "Appointment", headers: {} };
    });

    it("rejects a wrongly signed delivery and an unconfigured deployment before reading anything", async () => {
      const raw = event(eid(), "a@x.example");
      assert.equal((await deliver(raw, `whsec_${Buffer.from("some-other-secret").toString("base64")}`)).status, 401);
      delete process.env.RESEND_WEBHOOK_SECRET;
      assert.equal((await deliver(raw)).status, 503);
      assert.equal(fetchedBodies().length, 0);
    });

    it("an email from a stranger becomes an EMAIL lead; the same email id again is ignored", async () => {
      const from = `lena-${uniq()}@customer.example`;
      const id = eid();
      const raw = event(id, `Lena Park <${from}>`);
      const res = await deliver(raw);
      assert.equal(((await res.json()) as { outcome: string }).outcome, "created");
      assert.equal(fetchedBodies()[0].headers.Authorization, "Bearer re_test");
      const [lead] = await leads({ email: from });
      assert.equal(lead.source, "EMAIL");
      assert.equal(lead.firstName, "Lena");
      assert.match(lead.notes ?? "", /Subject: Appointment/);
      assert.match(lead.notes ?? "", /opening on Friday/);
      const again = await deliver(raw);
      assert.equal(((await again.json()) as { outcome: string }).outcome, "duplicate_event");
      assert.equal((await leads({ email: from })).length, 1);
    });

    it("a reply from someone we know is a note on their lead and tells the owner, not a second lead", async () => {
      const from = `known-${uniq()}@customer.example`;
      await deliver(event(eid(), from));
      received = { text: "Following up: can you call me instead?", subject: "Re: Appointment", headers: {} };
      const res = await deliver(event(eid(), from));
      assert.equal(((await res.json()) as { outcome: string }).outcome, "repeat");
      const found = await leads({ email: from });
      assert.equal(found.length, 1);
      const notes = await prisma.note.findMany({ where: { leadId: found[0].id } });
      assert.match(notes[0].body, /call me instead/);
      assert.equal((await prisma.notification.findMany({ where: { entityId: found[0].id, type: "ENQUIRY_RECEIVED" } })).length, 1);
    });

    it("ignores no-reply senders, auto-replies and mailboxes nobody registered, without making leads", async () => {
      const before = (await leads()).length;
      assert.equal(((await (await deliver(event(eid(), "no-reply@shop.example"))).json()) as { reason: string }).reason, "automated_sender");
      assert.equal(fetchedBodies().length, 0, "a no-reply sender is dropped before the body is even fetched");
      received = { text: "I am away", subject: "Out of office", headers: { "Auto-Submitted": "auto-replied" } };
      assert.equal(((await (await deliver(event(eid(), "someone@customer.example"))).json()) as { reason: string }).reason, "automated_sender");
      assert.equal(((await (await deliver(event(eid(), "x@customer.example", "unknown@inbound.example"))).json()) as { reason: string }).reason, "unknown_mailbox");
      assert.equal((await leads()).length, before);
    });

    it("a failed body fetch answers 5xx so Resend retries, then the retry creates exactly one lead", async () => {
      const from = `retry-${uniq()}@customer.example`;
      const raw = event(eid(), from);
      receivedStatus = 500;
      assert.equal((await deliver(raw)).status, 502);
      assert.equal((await leads({ email: from })).length, 0);
      receivedStatus = 200;
      assert.equal((await deliver(raw)).status, 200);
      assert.equal((await leads({ email: from })).length, 1);
    });
  });

  it("the source coverage registry shows website forms and Meta pages as live feeds", async () => {
    const coverage = await loadSourceCoverage(tenant.workspaceId);
    const feed = (s: string) => coverage.rows.find((r) => r.source === s)?.feed;
    // Rows exist once a source is declared or has produced leads: both did above.
    assert.equal(feed("WEB_FORM"), "live");
    assert.equal(feed("FACEBOOK_ADS"), "live");
  });
});
