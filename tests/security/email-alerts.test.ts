import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, beforeEach, describe, it, mock } from "node:test";
import { prisma } from "../../src/lib/db";
import { ALERT_HOURLY_CAP, alertContacts, emailAlertsConfigured } from "../../src/lib/alerts";
import { createLead } from "../../src/lib/leads/create-lead";
import { leadCreateSchema } from "../../src/lib/validations/leads";
import { createTenant, destroyTenant, type Tenant } from "../helpers/http";

type Call = { to: string; subject: string; text: string; key: string };

describe("Email alerts to people without a login", () => {
  let tenant: Tenant;
  let other: Tenant;
  const calls: Call[] = [];
  let status = 200;
  const saved = { key: process.env.RESEND_API_KEY, from: process.env.ALERT_FROM_EMAIL, url: process.env.AUTH_URL };
  const contact = (workspaceId: string, address: string) => prisma.alertContact.create({ data: { workspaceId, address } });
  const alert = (dedupeKey: string, workspaceId = tenant.workspaceId) =>
    alertContacts({ workspaceId, dedupeKey, subject: "Subject", lines: ["Body line"], href: "/leads/x" });

  before(async () => {
    tenant = await createTenant("alerts");
    other = await createTenant("alerts-other");
  });
  after(async () => {
    await destroyTenant(tenant);
    await destroyTenant(other);
  });
  beforeEach(async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.ALERT_FROM_EMAIL = "Acme <alerts@acme.example>";
    process.env.AUTH_URL = "https://crm.acme.example";
    calls.length = 0;
    status = 200;
    mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push({ to: body.to[0], subject: body.subject, text: body.text, key: (init.headers as Record<string, string>)["Idempotency-Key"] });
      return new Response("{}", { status });
    });
    await prisma.alertContact.deleteMany({ where: { workspaceId: { in: [tenant.workspaceId, other.workspaceId] } } });
  });
  afterEach(() => {
    mock.restoreAll();
    for (const [k, v] of [["RESEND_API_KEY", saved.key], ["ALERT_FROM_EMAIL", saved.from], ["AUTH_URL", saved.url]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("sends one email per contact, with a login link, and never to another workspace's contacts", async () => {
    await contact(tenant.workspaceId, "a@shop.example");
    await contact(tenant.workspaceId, "b@shop.example");
    await contact(other.workspaceId, "stranger@elsewhere.example");
    assert.deepEqual(await alert(`k-${randomUUID()}`), { sent: 2 });
    assert.deepEqual(calls.map((c) => c.to).sort(), ["a@shop.example", "b@shop.example"]);
    assert.match(calls[0].text, /https:\/\/crm\.acme\.example\/leads\/x/);
  });

  it("a replayed alert sends nothing the second time", async () => {
    await contact(tenant.workspaceId, "a@shop.example");
    const key = `k-${randomUUID()}`;
    await alert(key);
    await alert(key);
    assert.equal(calls.length, 1);
  });

  it("is a silent no-op when Resend is not configured", async () => {
    await contact(tenant.workspaceId, "a@shop.example");
    delete process.env.RESEND_API_KEY;
    assert.equal(emailAlertsConfigured(), false);
    assert.deepEqual(await alert(`k-${randomUUID()}`), { sent: 0 });
    assert.equal(calls.length, 0);
  });

  it("a rejected send is recorded FAILED without throwing; a 5xx is retried once", async () => {
    const c = await contact(tenant.workspaceId, "a@shop.example");
    status = 422;
    const key = `k-${randomUUID()}`;
    assert.deepEqual(await alert(key), { sent: 0 });
    assert.equal(calls.length, 1);
    const row = await prisma.alertDelivery.findFirstOrThrow({ where: { contactId: c.id, dedupeKey: key } });
    assert.equal(row.status, "FAILED");
    assert.equal(row.error, "http_422");
    calls.length = 0;
    status = 503;
    await alert(`k-${randomUUID()}`);
    assert.equal(calls.length, 2);
  });

  it("throttles a flood: past the hourly cap alerts are recorded THROTTLED and not sent", async () => {
    const c = await contact(tenant.workspaceId, "a@shop.example");
    await prisma.alertDelivery.createMany({
      data: Array.from({ length: ALERT_HOURLY_CAP }, (_, i) => ({ workspaceId: tenant.workspaceId, contactId: c.id, dedupeKey: `old-${i}`, status: "SENT" })),
    });
    const key = `k-${randomUUID()}`;
    assert.deepEqual(await alert(key), { sent: 0 });
    assert.equal(calls.length, 0);
    assert.equal((await prisma.alertDelivery.findFirstOrThrow({ where: { contactId: c.id, dedupeKey: key } })).status, "THROTTLED");
  });

  it("a new lead alerts the contacts with name and source but not the phone number", async () => {
    await contact(tenant.workspaceId, "a@shop.example");
    const phone = "+12025550143";
    await createLead(
      tenant.workspaceId,
      tenant.users.OWNER.id,
      leadCreateSchema.parse({ firstName: "Sara", lastName: "Khan", phone, source: "WEB_FORM", notes: "Wants a quote for two units" }),
    );
    assert.equal(calls.length, 1);
    assert.match(calls[0].subject, /New enquiry: Sara Khan/);
    assert.match(calls[0].text, /Wants a quote/);
    assert.ok(!calls[0].text.includes("2025550143"), "phone number must stay behind the login");
  });
});
