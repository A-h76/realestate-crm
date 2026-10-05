import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/lib/db";
import { canonicalPhone, identityKeys, phoneVariants } from "../../src/lib/leads/identity";
import { storeInboundMessage } from "../../src/lib/webhooks/whatsapp";
import { actAs, call, createTenant, destroyTenant, installSessionMock, type Tenant } from "../helpers/http";

/**
 * DATA-001 / DATA-002 / INTG-002: duplicate-lead prevention across manual, CSV and WhatsApp intake,
 * including concurrent delivery. Rules under test are documented in src/lib/leads/identity.ts.
 */
type Handler = Parameters<typeof call>[0];
let POST_LEAD: Handler;
let PATCH_LEAD: Handler;
let CSV: Handler;

/**
 * A complete, VALID US national number. The exchange (middle three digits) may not begin
 * with 0 or 1 under the NANP, and libphonenumber enforces that — so the exchange is drawn
 * from 2xx-9xx rather than from a plain 7-digit random, which would sometimes produce an
 * unroutable number the identity layer is right to reject.
 */
const mobile = () => `415${Math.floor(2 + Math.random() * 8)}${String(Math.floor(100_000 + Math.random() * 899_999))}`;
/** The canonical E.164 identity for a national number produced by `mobile()`. */
const e164 = (n: string) => `+1${n}`;
/** The same number as a US agent would type it — a different spelling, same identity. */
const typed = (n: string) => `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`;

describe("identity rules (pure)", () => {
  it("canonicalises complete US numbers in every common spelling and rejects partial numbers", () => {
    const n = mobile();
    for (const spelling of [
      e164(n),
      `1${n}`,
      n,
      `+1 ${n.slice(0, 3)}-${n.slice(3, 6)}-${n.slice(6)}`,
      `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`,
      `${n.slice(0, 3)}.${n.slice(3, 6)}.${n.slice(6)}`,
    ]) {
      assert.equal(canonicalPhone(spelling), e164(n), spelling);
    }
    for (const partial of ["415", "0415", "+1415555", "12345", "", null, undefined, "n/a"]) {
      assert.equal(canonicalPhone(partial as string | null), null, String(partial));
    }
    const variants = phoneVariants(e164(n));
    for (const expected of [e164(n), `1${n}`, n, `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`]) {
      assert.ok(variants.includes(expected), `${expected} missing`);
    }
  });

  it("builds lock keys from phone and email only; names contribute nothing", () => {
    const n = mobile();
    assert.deepEqual(identityKeys({ phone: n, whatsappNumber: e164(n), email: " A@B.com " }), [`e:a@b.com`, `p:${e164(n)}`]);
    assert.deepEqual(identityKeys({}), []);
  });
});

describe("duplicate leads over HTTP", () => {
  let tenant: Tenant;
  let other: Tenant;

  before(async () => {
    installSessionMock();
    ({ POST: POST_LEAD } = await import("../../src/app/api/leads/route"));
    ({ PATCH: PATCH_LEAD } = await import("../../src/app/api/leads/[id]/route"));
    ({ POST: CSV } = await import("../../src/app/api/leads/csv/route"));
    tenant = await createTenant("dedup");
    other = await createTenant("dedup-other");
    actAs(tenant.users.AGENT);
  });

  after(async () => {
    await destroyTenant(tenant);
    await destroyTenant(other);
  });

  const create = (body: Record<string, unknown>) => call(POST_LEAD, "POST", { body });

  it("same phone in a different spelling is a duplicate (409) and points at the existing lead", async () => {
    const n = mobile();
    const first = await create({ firstName: "Ali", phone: typed(n) });
    assert.equal(first.status, 201);
    assert.equal(first.body.phone, e164(n), "stored in canonical form");
    for (const phone of [e164(n), `1${n}`, `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`]) {
      const dup = await create({ firstName: "Someone Else", phone });
      assert.equal(dup.status, 409, phone);
      assert.equal(dup.body.duplicateOf.id, first.body.id);
    }
    assert.equal(await prisma.lead.count({ where: { workspaceId: tenant.workspaceId, phone: e164(n) } }), 1);
  });

  it("whatsappNumber and phone are cross-matched", async () => {
    const n = mobile();
    assert.equal((await create({ firstName: "A", whatsappNumber: e164(n) })).status, 201);
    assert.equal((await create({ firstName: "B", phone: typed(n) })).status, 409);
  });

  it("same email, any case, is a duplicate", async () => {
    const email = `dup-${randomUUID()}@example.test`;
    assert.equal((await create({ firstName: "A", email })).status, 201);
    assert.equal((await create({ firstName: "B", email: email.toUpperCase() })).status, 409);
  });

  it("does NOT merge different people: same name, partial numbers, other numbers or no contact details", async () => {
    assert.equal((await create({ firstName: "Same", lastName: "Name", phone: `0${mobile()}` })).status, 201);
    assert.equal((await create({ firstName: "Same", lastName: "Name", phone: `0${mobile()}` })).status, 201, "same name, different phone");
    assert.equal((await create({ firstName: "Same", lastName: "Name" })).status, 201, "same name, no contact details");
    assert.equal((await create({ firstName: "Same", lastName: "Name" })).status, 201, "twice");
    assert.equal((await create({ firstName: "P1", phone: "415555" })).status, 201, "partial number");
    assert.equal((await create({ firstName: "P2", phone: "415555" })).status, 201, "same partial number is not an identity");
  });

  it("allowDuplicate overrides the check; other workspaces and deleted leads never block", async () => {
    const n = mobile();
    const first = await create({ firstName: "Orig", phone: n });
    assert.equal((await create({ firstName: "Forced", phone: n, allowDuplicate: true })).status, 201);
    actAs(other.users.AGENT);
    assert.equal((await create({ firstName: "OtherWs", phone: n })).status, 201, "different workspace");
    actAs(tenant.users.AGENT);
    await prisma.lead.updateMany({ where: { workspaceId: tenant.workspaceId, phone: e164(n) }, data: { deletedAt: new Date() } });
    assert.equal((await create({ firstName: "AfterDelete", phone: n })).status, 201, "soft-deleted leads do not count");
    void first;
  });

  it("editing a lead onto another lead's phone or email is refused unless overridden", async () => {
    const n = mobile();
    const taken = await create({ firstName: "Taken", phone: n });
    const mine = await create({ firstName: "Mine", phone: mobile() });
    const clash = await call(PATCH_LEAD, "PATCH", { params: { id: mine.body.id }, body: { phone: typed(n) } });
    assert.equal(clash.status, 409);
    assert.equal(clash.body.duplicateOf.id, taken.body.id);
    const fine = await call(PATCH_LEAD, "PATCH", { params: { id: mine.body.id }, body: { firstName: "Renamed" } });
    assert.equal(fine.status, 200, "unrelated edits are never blocked by an existing duplicate");
    const forced = await call(PATCH_LEAD, "PATCH", { params: { id: mine.body.id }, body: { phone: typed(n), allowDuplicate: true } });
    assert.equal(forced.status, 200);
  });

  it("VIEWER cannot create leads", async () => {
    actAs(tenant.users.VIEWER);
    assert.equal((await create({ firstName: "Nope", phone: mobile() })).status, 403);
    actAs(tenant.users.AGENT);
  });

  it("concurrent identical submissions create exactly one lead", async () => {
    for (let round = 0; round < 3; round++) {
      const n = mobile();
      const results = await Promise.all(Array.from({ length: 8 }, (_, i) => create({ firstName: `Race${i}`, phone: i % 2 ? n : e164(n) })));
      const statuses = results.map((r) => r.status).sort();
      assert.deepEqual(statuses, [201, 409, 409, 409, 409, 409, 409, 409], `round ${round}`);
      assert.equal(await prisma.lead.count({ where: { workspaceId: tenant.workspaceId, phone: e164(n) } }), 1);
    }
  });

  it("CSV import skips rows matching existing leads in any spelling, and a concurrent double-import inserts each person once", async () => {
    const existing = mobile();
    await create({ firstName: "Existing", phone: existing });
    const fresh = [mobile(), mobile(), mobile()];
    const csv = [
      "firstName,lastName,phone",
      `Existing,Csv,${e164(existing)}`,
      ...fresh.map((p, i) => `New${i},Csv,${typed(p)}`),
    ].join("\n");
    actAs(tenant.users.OWNER);
    const [a, b] = await Promise.all([call(CSV, "POST", { rawBody: csv }), call(CSV, "POST", { rawBody: csv })]);
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(b.status, 200);
    assert.equal(a.body.created + b.body.created, 3, "each new person is inserted exactly once across both imports");
    for (const p of fresh) {
      assert.equal(await prisma.lead.count({ where: { workspaceId: tenant.workspaceId, deletedAt: null, whatsappNumber: e164(p) } }), 1);
    }
    assert.equal(await prisma.lead.count({ where: { workspaceId: tenant.workspaceId, deletedAt: null, phone: e164(existing) } }), 1);
    actAs(tenant.users.AGENT);
  });
});

describe("WhatsApp inbound lead resolution", () => {
  let tenant: Tenant;

  before(async () => {
    tenant = await createTenant("wa-dedup");
  });

  after(async () => {
    await destroyTenant(tenant);
  });

  const inbound = (phone: string, externalId = `wamid.${randomUUID()}`, body = "Hello, looking for a house in Lincoln Park") =>
    storeInboundMessage({ workspaceId: tenant.workspaceId, phone, body, externalId, profileName: "Test Caller", extractable: false });
  const leadsFor = (n: string) =>
    prisma.lead.findMany({ where: { workspaceId: tenant.workspaceId, deletedAt: null, whatsappNumber: e164(n) } });

  it("attaches to a manually created lead that has the same number in another spelling", async () => {
    const n = mobile();
    const manual = await prisma.lead.create({ data: { workspaceId: tenant.workspaceId, firstName: "Manual", phone: typed(n) } });
    assert.equal(await inbound(e164(n)), "created");
    // One person, one lead — whichever spelling either side used.
    assert.equal(
      await prisma.lead.count({
        where: {
          workspaceId: tenant.workspaceId,
          OR: [{ phone: { in: [n, e164(n), typed(n)] } }, { whatsappNumber: { in: [n, e164(n), typed(n)] } }],
        },
      }),
      1,
    );
    assert.equal(await prisma.whatsAppMessage.count({ where: { workspaceId: tenant.workspaceId, leadId: manual.id } }), 1);
  });

  it("a different number is a different lead", async () => {
    const [a, b] = [mobile(), mobile()];
    await inbound(e164(a));
    await inbound(e164(b));
    assert.equal((await leadsFor(a)).length, 1);
    assert.equal((await leadsFor(b)).length, 1);
  });

  it("a replayed event is a duplicate and creates nothing", async () => {
    const n = mobile();
    const id = `wamid.${randomUUID()}`;
    assert.equal(await inbound(e164(n), id), "created");
    assert.equal(await inbound(e164(n), id), "duplicate");
    assert.equal(await prisma.whatsAppMessage.count({ where: { workspaceId: tenant.workspaceId, externalId: id } }), 1);
    assert.equal((await leadsFor(n)).length, 1);
  });

  it("concurrent first messages from one new number create exactly one lead with all messages attached", async () => {
    for (let round = 0; round < 3; round++) {
      const n = mobile();
      const results = await Promise.all(Array.from({ length: 6 }, () => inbound(e164(n))));
      assert.ok(results.every((r) => r === "created"));
      const leads = await leadsFor(n);
      assert.equal(leads.length, 1, `round ${round}: one lead`);
      assert.equal(await prisma.whatsAppMessage.count({ where: { workspaceId: tenant.workspaceId, leadId: leads[0].id } }), 6);
    }
  });

  it("concurrent replays of the SAME event leave one message and no orphan lead", async () => {
    for (let round = 0; round < 3; round++) {
      const n = mobile();
      const id = `wamid.${randomUUID()}`;
      const results = await Promise.all(Array.from({ length: 5 }, () => inbound(e164(n), id)));
      assert.equal(results.filter((r) => r === "created").length, 1);
      assert.equal(results.filter((r) => r === "duplicate").length, 4);
      assert.equal((await leadsFor(n)).length, 1, `round ${round}: no orphan lead`);
      assert.equal(await prisma.whatsAppMessage.count({ where: { workspaceId: tenant.workspaceId, externalId: id } }), 1);
    }
  });

  it("the same number in two workspaces stays two leads", async () => {
    const other = await createTenant("wa-dedup-b");
    try {
      const n = mobile();
      await inbound(e164(n));
      await storeInboundMessage({ workspaceId: other.workspaceId, phone: e164(n), body: "hi", externalId: `wamid.${randomUUID()}`, profileName: null, extractable: false });
      assert.equal(await prisma.lead.count({ where: { whatsappNumber: e164(n), workspaceId: { in: [tenant.workspaceId, other.workspaceId] } } }), 2);
    } finally {
      await destroyTenant(other);
    }
  });

  it("a new inbound lead fires its LEAD_CREATED task once, even when messages race", async () => {
    await prisma.automation.create({
      data: { workspaceId: tenant.workspaceId, name: "new lead task", trigger: "LEAD_CREATED", enabled: true, paused: false, actions: [{ type: "CREATE_TASK", title: "Contact", priority: "HIGH", dueInDays: 1 }] },
    });
    const n = mobile();
    await Promise.all(Array.from({ length: 4 }, () => inbound(e164(n))));
    const [lead] = await leadsFor(n);
    assert.equal(await prisma.task.count({ where: { workspaceId: tenant.workspaceId, leadId: lead.id } }), 1);
  });
});
