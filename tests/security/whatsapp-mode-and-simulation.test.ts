import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { prisma } from "../../src/lib/db";
import { describeWhatsAppStatus, getWhatsAppProvider, whatsappStatus } from "../../src/lib/providers/whatsapp";
import { actAs, call, createTenant, destroyTenant, installSessionMock, type Tenant } from "../helpers/http";

/**
 * INTG-008 (explicit demo vs live, fail safe when live is selected but not configured) and INTG-011 (the
 * simulate-inbound endpoint runs the real inbound pipeline, is demo-only, and cannot touch a real customer).
 * No test here uses real credentials or reaches the network: fetch is replaced with a counter that fails the
 * moment anything tries to call out.
 */
const ENV_KEYS = [
  "DEMO_MODE",
  "NODE_ENV",
  "WHATSAPP_BUSINESS_ENABLED",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_APP_SECRET",
  "WHATSAPP_VERIFY_TOKEN",
] as const;
const saved: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;
const outbound = { calls: 0 };

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const k of ENV_KEYS) {
    if (values[k] === undefined) delete process.env[k];
    else (process.env as Record<string, string>)[k] = values[k]!;
  }
}

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  outbound.calls = 0;
  globalThis.fetch = (async () => {
    outbound.calls += 1;
    throw new Error("test attempted a real network call");
  }) as typeof fetch;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else (process.env as Record<string, string>)[k] = saved[k]!;
  }
  globalThis.fetch = realFetch;
});

describe("whatsappStatus(): which provider is really running", () => {
  const status = (env: Record<string, string>) => whatsappStatus(env as NodeJS.ProcessEnv);

  it("live only when selected AND both credentials are present", () => {
    assert.equal(status({ WHATSAPP_BUSINESS_ENABLED: "true", WHATSAPP_ACCESS_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "p" }).mode, "live");
  });

  it("selected but missing credentials is 'misconfigured', and names exactly what is missing", () => {
    const s = status({ WHATSAPP_BUSINESS_ENABLED: "true", WHATSAPP_ACCESS_TOKEN: "t" });
    assert.equal(s.mode, "misconfigured");
    assert.deepEqual(s.missingOutbound, ["WHATSAPP_PHONE_NUMBER_ID"]);
    assert.equal(status({ WHATSAPP_BUSINESS_ENABLED: "true" }).mode, "misconfigured");
  });

  it("only the exact string 'true' selects live", () => {
    for (const v of ["TRUE", "1", "yes", "false", ""]) {
      assert.notEqual(status({ WHATSAPP_BUSINESS_ENABLED: v, WHATSAPP_ACCESS_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "p", NODE_ENV: "production" }).mode, "live", v);
    }
  });

  it("not selected: demo outside production, demo in production only with DEMO_MODE=true, otherwise 'disabled'", () => {
    assert.equal(status({ NODE_ENV: "development" }).mode, "demo");
    assert.equal(status({ NODE_ENV: "test" }).mode, "demo");
    setEnv({ DEMO_MODE: "true" });
    assert.equal(status({ NODE_ENV: "production" }).mode, "demo");
    setEnv({});
    assert.equal(status({ NODE_ENV: "production" }).mode, "disabled");
  });

  it("live reports which inbound settings are missing; the description never contains a secret value", () => {
    const env = { WHATSAPP_BUSINESS_ENABLED: "true", WHATSAPP_ACCESS_TOKEN: "SECRET-TOKEN-VALUE", WHATSAPP_PHONE_NUMBER_ID: "PHONE-ID-VALUE" };
    const s = status(env);
    assert.deepEqual(s.missingInbound, ["WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN"]);
    const text = describeWhatsAppStatus(s);
    assert.match(text, /WHATSAPP_APP_SECRET/);
    for (const mode of ["live", "misconfigured", "demo", "disabled"] as const) {
      const out = describeWhatsAppStatus({ mode, missingOutbound: ["WHATSAPP_ACCESS_TOKEN"], missingInbound: [] });
      assert.ok(!out.includes("SECRET-TOKEN-VALUE") && !out.includes("PHONE-ID-VALUE"), mode);
    }
    assert.ok(!text.includes("SECRET-TOKEN-VALUE") && !text.includes("PHONE-ID-VALUE"));
  });
});

describe("sending when live is selected but not configured, or nothing is enabled in production", () => {
  let t: Tenant;
  let leadId: string;

  before(async () => {
    installSessionMock();
    t = await createTenant("wa-mode");
    leadId = (await prisma.lead.create({ data: { workspaceId: t.workspaceId, firstName: "Mode", whatsappNumber: "+14155550201" } })).id;
  });
  after(async () => destroyTenant(t));

  const send = () => getWhatsAppProvider().sendMessage(t.workspaceId, { conversationId: `lead:${leadId}`, body: "hello", leadId });

  it("misconfigured live mode stores FAILED with the reason, never a demo 'SENT', and makes no network call", async () => {
    setEnv({ WHATSAPP_BUSINESS_ENABLED: "true", WHATSAPP_ACCESS_TOKEN: "only-the-token" });
    const m = await send();
    assert.equal(m.status, "FAILED");
    assert.equal(m.provider, "whatsapp-business");
    assert.equal(m.externalId, null);
    assert.match((m.metadata as { error: string }).error, /WHATSAPP_PHONE_NUMBER_ID/);
    assert.ok(!JSON.stringify(m.metadata).includes("only-the-token"));
    assert.equal(outbound.calls, 0);
  });

  it("production with nothing enabled and no Demo Mode: FAILED 'not connected', not a fake delivery", async () => {
    setEnv({ NODE_ENV: "production" });
    const m = await send();
    assert.equal(m.status, "FAILED");
    assert.notEqual(m.provider, "demo");
    assert.match((m.metadata as { error: string }).error, /not connected/i);
    assert.equal(outbound.calls, 0);
  });

  it("demo mode still records a clearly-labelled demo message", async () => {
    setEnv({ DEMO_MODE: "true", NODE_ENV: "production" });
    const m = await send();
    assert.equal(m.provider, "demo");
    assert.match((m.metadata as { demoNotice: string }).demoNotice, /No real WhatsApp message was sent/);
  });

  it("POST /api/whatsapp/messages tells the user it was NOT delivered and logs the activity as not delivered", async () => {
    const { POST } = await import("../../src/app/api/whatsapp/messages/route");
    setEnv({ NODE_ENV: "production" });
    actAs(t.users.AGENT);
    const res = await call(POST, "POST", { body: { conversationId: `lead:${leadId}`, body: "are you there", leadId } });
    assert.equal(res.status, 201);
    assert.equal(res.body.demo, false);
    assert.equal(res.body.message.status, "FAILED");
    assert.match(res.body.notice, /not delivered/i);
    const activity = await prisma.activity.findFirstOrThrow({ where: { leadId, notes: "are you there" } });
    assert.equal(activity.title, "WhatsApp message not delivered");
    assert.equal(activity.status, "CANCELLED");
  });
});

describe("POST /api/whatsapp/simulate-inbound", () => {
  let t: Tenant;
  let other: Tenant;
  let leadId: string;
  let noPhoneLeadId: string;
  let foreignLeadId: string;
  let SIMULATE: (typeof import("../../src/app/api/whatsapp/simulate-inbound/route"))["POST"];

  before(async () => {
    installSessionMock();
    ({ POST: SIMULATE } = await import("../../src/app/api/whatsapp/simulate-inbound/route"));
    t = await createTenant("wa-sim");
    other = await createTenant("wa-sim-other");
    leadId = (await prisma.lead.create({ data: { workspaceId: t.workspaceId, firstName: "Sim", lastName: "Customer", whatsappNumber: "+14155550202", ownerId: t.users.AGENT.id } })).id;
    noPhoneLeadId = (await prisma.lead.create({ data: { workspaceId: t.workspaceId, firstName: "NoPhone" } })).id;
    foreignLeadId = (await prisma.lead.create({ data: { workspaceId: other.workspaceId, firstName: "Foreign", whatsappNumber: "+14155550203" } })).id;
  });
  after(async () => {
    await destroyTenant(t);
    await destroyTenant(other);
  });

  const simulate = (body: Record<string, unknown>) => call(SIMULATE, "POST", { body: { conversationId: `lead:${leadId}`, ...body } });
  const demoOn = () => setEnv({ DEMO_MODE: "true" });
  const count = () => prisma.whatsAppMessage.count({ where: { workspaceId: t.workspaceId } });

  it("is refused outside Demo Mode, and creates nothing", async () => {
    setEnv({});
    actAs(t.users.OWNER);
    const before_ = await count();
    const res = await simulate({ leadId, body: "hello" });
    assert.equal(res.status, 403);
    assert.equal(await count(), before_);
  });

  it("a read-only member cannot simulate, even in Demo Mode", async () => {
    demoOn();
    actAs(t.users.VIEWER);
    assert.equal((await simulate({ leadId, body: "hello" })).status, 403);
  });

  it("is refused while a live provider is selected (the pipeline could auto-reply to a real customer)", async () => {
    setEnv({ DEMO_MODE: "true", WHATSAPP_BUSINESS_ENABLED: "true", WHATSAPP_ACCESS_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "p" });
    actAs(t.users.OWNER);
    const before_ = await count();
    const res = await simulate({ leadId, body: "I want to talk to an agent" });
    assert.equal(res.status, 400);
    assert.equal(await count(), before_);
    assert.equal(outbound.calls, 0);
  });

  it("needs a lead with a phone, in the caller's own workspace", async () => {
    demoOn();
    actAs(t.users.OWNER);
    assert.equal((await simulate({ leadId: noPhoneLeadId, body: "hi" })).status, 400);
    assert.equal((await simulate({ body: "hi" })).status, 400);
    assert.ok([400, 404].includes((await simulate({ leadId: foreignLeadId, body: "hi" })).status));
    assert.equal(await prisma.whatsAppMessage.count({ where: { leadId: foreignLeadId } }), 0);
  });

  it("a handoff phrase runs the REAL pipeline: tagged demo, real handoff task and audit, no auto-reply, no network", async () => {
    demoOn();
    actAs(t.users.AGENT);
    const res = await simulate({ leadId, body: "I want to talk to an agent" });
    assert.equal(res.status, 201);
    assert.equal(res.body.simulated, true);
    const msg = await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: res.body.message.id } });
    assert.equal(msg.direction, "INBOUND");
    assert.equal(msg.provider, "demo");
    assert.equal(msg.leadId, leadId);
    assert.ok(msg.externalId?.startsWith("sim-"));
    assert.equal((msg.metadata as { simulated: boolean }).simulated, true);

    // Same side effects as a Meta delivery: handoff audit + open handoff task.
    assert.equal(await prisma.auditLog.count({ where: { workspaceId: t.workspaceId, action: "HANDOFF_TRIGGERED", entityId: leadId } }), 1);
    assert.ok(await prisma.task.findFirst({ where: { leadId, description: { contains: "[handoff:" } } }));
    // The audit row says who simulated it and that it was a simulation, not a webhook.
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { workspaceId: t.workspaceId, entityId: msg.id, action: "WHATSAPP_MESSAGE_LOGGED" } });
    assert.equal(audit.actorId, t.users.AGENT.id);
    assert.deepEqual(audit.metadata, { direction: "INBOUND", demo: true, simulated: true });
    // Event claimed under its own provider key, so it can never collide with a real Meta event id.
    assert.equal(await prisma.webhookEvent.count({ where: { externalEventId: msg.externalId!, provider: "whatsapp-simulated" } }), 1);
    assert.equal(await prisma.webhookEvent.count({ where: { externalEventId: msg.externalId!, provider: "whatsapp" } }), 0);
    assert.equal(await prisma.whatsAppMessage.count({ where: { leadId, direction: "OUTBOUND" } }), 0, "handoff means no automatic reply");
    assert.equal(outbound.calls, 0);
  });

  it("an ordinary message is DRAFTED, not sent, because DRAFT is the default AI mode", async () => {
    demoOn();
    actAs(t.users.MANAGER);
    const fresh = (await prisma.lead.create({ data: { workspaceId: t.workspaceId, firstName: "Chat", whatsappNumber: "+14155550204" } })).id;
    const res = await simulate({ conversationId: `lead:${fresh}`, leadId: fresh, body: "I am looking for a house to rent in Logan Square" });
    assert.equal(res.status, 201);
    const reply = await prisma.whatsAppMessage.findFirstOrThrow({ where: { leadId: fresh, direction: "OUTBOUND" } });
    assert.equal(reply.provider, "demo");
    assert.equal(reply.status, "DRAFT", "the assistant drafts for a human unless the workspace opted into AUTO");
    assert.equal((reply.metadata as { awaitingApproval?: boolean }).awaitingApproval, true);
    assert.equal((reply.metadata as { auto?: boolean }).auto, true);
    assert.equal(outbound.calls, 0);
  });

  it("the same message is actually sent once the workspace opts into AUTO", async () => {
    demoOn();
    actAs(t.users.MANAGER);
    await prisma.workspace.update({ where: { id: t.workspaceId }, data: { aiMode: "AUTO" } });
    try {
      const fresh = (await prisma.lead.create({ data: { workspaceId: t.workspaceId, firstName: "AutoChat", whatsappNumber: "+14155550206" } })).id;
      const res = await simulate({ conversationId: `lead:${fresh}`, leadId: fresh, body: "I am looking for a house to rent in Logan Square" });
      assert.equal(res.status, 201);
      const reply = await prisma.whatsAppMessage.findFirstOrThrow({ where: { leadId: fresh, direction: "OUTBOUND" } });
      assert.equal(reply.provider, "demo");
      assert.notEqual(reply.status, "DRAFT");
      assert.equal((reply.metadata as { auto?: boolean }).auto, true);
      assert.match((reply.metadata as { demoNotice: string }).demoNotice, /No real WhatsApp message was sent/);
      assert.equal(outbound.calls, 0, "demo provider still never reaches a real recipient");
    } finally {
      await prisma.workspace.update({ where: { id: t.workspaceId }, data: { aiMode: "DRAFT" } });
    }
  });

  it("each simulation is its own event (two identical messages are both stored, not deduped as a replay)", async () => {
    demoOn();
    actAs(t.users.OWNER);
    const fresh = (await prisma.lead.create({ data: { workspaceId: t.workspaceId, firstName: "Twice", whatsappNumber: "+14155550205" } })).id;
    const a = await simulate({ conversationId: `lead:${fresh}`, leadId: fresh, body: "I want to speak to an agent" });
    const b = await simulate({ conversationId: `lead:${fresh}`, leadId: fresh, body: "I want to speak to an agent" });
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.notEqual(a.body.message.externalId, b.body.message.externalId);
    assert.equal(await prisma.whatsAppMessage.count({ where: { leadId: fresh, direction: "INBOUND" } }), 2);
  });
});

