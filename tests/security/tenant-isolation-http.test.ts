import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import type { WorkspaceRole } from "@prisma/client";
import { prisma } from "../../src/lib/db";
import {
  actAs,
  call,
  createTenant,
  destroyTenant,
  installSessionMock,
  ROLES,
  type Tenant,
} from "../helpers/http";

/**
 * TEST-001: cross-workspace isolation at the HTTP boundary. Every record below belongs to
 * workspace B; every request is made by an authenticated user of workspace A, once per role.
 * Real route handlers + real RBAC + real database — only the session lookup is injected.
 * Dropping a `workspaceId` filter from any of these routes makes a test here fail.
 */
type Handler = Parameters<typeof call>[0];
type Mod = Partial<Record<"GET" | "POST" | "PATCH" | "DELETE", Handler>>;

const MARK = `ZZMARK${randomUUID().slice(0, 8)}`;
const WRITE_ROLES: WorkspaceRole[] = ["OWNER", "ADMIN", "MANAGER", "AGENT"]; // crm:write + crm:delete

let A: Tenant;
let B: Tenant;

type Resource = {
  name: string;
  load: () => Promise<Mod>;
  create: (t: Tenant) => Promise<string>;
  patch: Record<string, unknown>;
  hasGet: boolean;
  list?: () => Promise<Mod>;
  /** re-read the record from the database (raw, including soft-delete flag) */
  reload: (id: string) => Promise<{ deletedAt: Date | null } & Record<string, unknown>>;
};

const resources: Resource[] = [
  {
    name: "lead",
    load: () => import("../../src/app/api/leads/[id]/route"),
    list: () => import("../../src/app/api/leads/route"),
    create: async (t) => (await prisma.lead.create({ data: { workspaceId: t.workspaceId, firstName: "Lead", lastName: MARK } })).id,
    patch: { firstName: "Hacked" },
    hasGet: true,
    reload: (id) => prisma.lead.findUniqueOrThrow({ where: { id } }),
  },
  {
    name: "contact",
    load: () => import("../../src/app/api/contacts/[id]/route"),
    list: () => import("../../src/app/api/contacts/route"),
    create: async (t) => (await prisma.contact.create({ data: { workspaceId: t.workspaceId, firstName: "Contact", lastName: MARK } })).id,
    patch: { firstName: "Hacked" },
    hasGet: true,
    reload: (id) => prisma.contact.findUniqueOrThrow({ where: { id } }),
  },
  {
    name: "account",
    load: () => import("../../src/app/api/accounts/[id]/route"),
    list: () => import("../../src/app/api/accounts/route"),
    create: async (t) => (await prisma.account.create({ data: { workspaceId: t.workspaceId, company: `Co ${MARK}` } })).id,
    patch: { company: "Hacked" },
    hasGet: true,
    reload: (id) => prisma.account.findUniqueOrThrow({ where: { id } }),
  },
  {
    name: "property",
    load: () => import("../../src/app/api/properties/[id]/route"),
    list: () => import("../../src/app/api/properties/route"),
    create: async (t) =>
      (await prisma.property.create({ data: { workspaceId: t.workspaceId, title: `Prop ${MARK}`, propertyType: "SINGLE_FAMILY", purpose: "SALE", price: 1, city: "Chicago" } })).id,
    patch: { title: "Hacked" },
    hasGet: true,
    reload: (id) => prisma.property.findUniqueOrThrow({ where: { id } }),
  },
  {
    name: "opportunity",
    load: () => import("../../src/app/api/opportunities/[id]/route"),
    list: () => import("../../src/app/api/opportunities/route"),
    create: async (t) =>
      (await prisma.opportunity.create({ data: { workspaceId: t.workspaceId, name: `Opp ${MARK}`, dealSide: "BUYER", value: 1, stageId: t.stages.open } })).id,
    patch: { name: "Hacked" },
    hasGet: true,
    reload: (id) => prisma.opportunity.findUniqueOrThrow({ where: { id } }),
  },
  {
    name: "task",
    load: () => import("../../src/app/api/tasks/[id]/route"),
    list: () => import("../../src/app/api/tasks/route"),
    create: async (t) => (await prisma.task.create({ data: { workspaceId: t.workspaceId, title: `Task ${MARK}` } })).id,
    patch: { title: "Hacked" },
    hasGet: true,
    reload: (id) => prisma.task.findUniqueOrThrow({ where: { id } }),
  },
  {
    name: "proposal",
    load: () => import("../../src/app/api/proposals/[id]/route"),
    list: () => import("../../src/app/api/proposals/route"),
    create: async (t) =>
      (await prisma.proposal.create({ data: { workspaceId: t.workspaceId, proposalNumber: `P-${MARK}`, value: 1 } })).id,
    patch: { notes: "Hacked" },
    hasGet: true,
    reload: (id) => prisma.proposal.findUniqueOrThrow({ where: { id } }),
  },
  {
    name: "calendar event",
    load: () => import("../../src/app/api/calendar/[id]/route"),
    list: () => import("../../src/app/api/calendar/route"),
    create: async (t) =>
      (
        await prisma.calendarEvent.create({
          data: { workspaceId: t.workspaceId, title: `Visit ${MARK}`, startAt: new Date(), endAt: new Date(Date.now() + 3600_000) },
        })
      ).id,
    patch: { title: "Hacked" },
    hasGet: false,
    reload: (id) => prisma.calendarEvent.findUniqueOrThrow({ where: { id } }),
  },
];

describe("Cross-workspace isolation at the HTTP boundary", () => {
  before(async () => {
    installSessionMock();
    A = await createTenant("iso-a");
    B = await createTenant("iso-b");
  });

  after(async () => {
    await destroyTenant(A);
    await destroyTenant(B);
  });

  for (const resource of resources) {
    describe(resource.name, () => {
      let mod: Mod;
      let listMod: Mod;
      let foreignId: string;
      let ownId: string;
      let before_: Record<string, unknown>;

      before(async () => {
        mod = await resource.load();
        listMod = await resource.list!();
        foreignId = await resource.create(B);
        ownId = await resource.create(A);
        before_ = await resource.reload(foreignId);
      });

      it("positive control: the owning workspace can read/write its own record", async () => {
        actAs(B.users.OWNER);
        if (resource.hasGet) {
          const res = await call(mod.GET!, "GET", { params: { id: foreignId } });
          assert.equal(res.status, 200);
        }
        actAs(A.users.OWNER);
        const own = await call(mod.PATCH!, "PATCH", { params: { id: ownId }, body: resource.patch });
        assert.equal(own.status, 200, JSON.stringify(own.body));
      });

      if (resource.hasGet) {
        for (const role of ROLES) {
          it(`GET another workspace's record as ${role} → 404, no data leaked`, async () => {
            actAs(A.users[role]);
            const res = await call(mod.GET!, "GET", { params: { id: foreignId } });
            assert.equal(res.status, 404);
            assert.ok(!JSON.stringify(res.body).includes(MARK));
          });
        }
      }

      for (const role of ROLES) {
        it(`PATCH another workspace's record as ${role} → ${WRITE_ROLES.includes(role) ? 404 : 403}`, async () => {
          actAs(A.users[role]);
          const res = await call(mod.PATCH!, "PATCH", { params: { id: foreignId }, body: resource.patch });
          assert.equal(res.status, WRITE_ROLES.includes(role) ? 404 : 403);
        });

        it(`DELETE another workspace's record as ${role} → ${WRITE_ROLES.includes(role) ? 404 : 403}`, async () => {
          actAs(A.users[role]);
          const res = await call(mod.DELETE!, "DELETE", { params: { id: foreignId } });
          assert.equal(res.status, WRITE_ROLES.includes(role) ? 404 : 403);
        });
      }

      it("the foreign record is untouched after every attempt above", async () => {
        const after_ = await resource.reload(foreignId);
        assert.equal(after_.deletedAt, null, "must not be soft-deleted");
        assert.deepEqual({ ...after_, updatedAt: null }, { ...before_, updatedAt: null });
      });

      for (const role of ROLES) {
        it(`list endpoint as ${role} never includes another workspace's rows`, async () => {
          actAs(A.users[role]);
          const res = await call(listMod.GET!, "GET");
          assert.equal(res.status, 200);
          const text = JSON.stringify(res.body);
          assert.ok(!text.includes(foreignId), "foreign id leaked into list");
          assert.ok(!text.includes(MARK) || text.includes(ownId), "foreign marker leaked into list");
          assert.ok(text.includes(ownId), "positive control: own record is listed");
        });
      }
    });
  }

  describe("related records cannot be linked across workspaces", () => {
    let leadB: string;
    let propertyB: string;
    let accountB: string;

    before(async () => {
      leadB = await resources[0].create(B);
      propertyB = await resources[3].create(B);
      accountB = await resources[2].create(B);
    });

    it("POST /api/opportunities with B's lead / property / account / stage is rejected and creates nothing", async () => {
      const { POST } = await import("../../src/app/api/opportunities/route");
      actAs(A.users.AGENT);
      const attempts: Array<Record<string, unknown>> = [
        { stageId: A.stages.open, leadId: leadB },
        { stageId: A.stages.open, linkedPropertyId: propertyB },
        { stageId: A.stages.open, accountId: accountB },
        { stageId: B.stages.open },
      ];
      for (const extra of attempts) {
        const res = await call(POST!, "POST", { body: { name: `Probe ${MARK}`, dealSide: "BUYER", value: 1, ...extra } });
        assert.ok([400, 404].includes(res.status), `expected rejection, got ${res.status} for ${JSON.stringify(extra)}`);
      }
      assert.equal(await prisma.opportunity.count({ where: { workspaceId: A.workspaceId, name: `Probe ${MARK}` } }), 0);
    });

    it("PATCH of A's own opportunity cannot be re-pointed at B's property or stage", async () => {
      const { PATCH } = await import("../../src/app/api/opportunities/[id]/route");
      const own = await prisma.opportunity.create({
        data: { workspaceId: A.workspaceId, name: "Own", dealSide: "BUYER", value: 1, stageId: A.stages.open },
      });
      actAs(A.users.AGENT);
      for (const body of [{ linkedPropertyId: propertyB }, { stageId: B.stages.won }, { stageId: B.stages.open }]) {
        const res = await call(PATCH!, "PATCH", { params: { id: own.id }, body });
        assert.ok([400, 404].includes(res.status), `got ${res.status} for ${JSON.stringify(body)}`);
      }
      const reloaded = await prisma.opportunity.findUniqueOrThrow({ where: { id: own.id } });
      assert.equal(reloaded.linkedPropertyId, null);
      assert.equal(reloaded.stageId, A.stages.open);
    });

    it("POST /api/tasks and /api/proposals cannot reference B's records", async () => {
      const tasks = await import("../../src/app/api/tasks/route");
      const proposals = await import("../../src/app/api/proposals/route");
      actAs(A.users.AGENT);
      const t = await call(tasks.POST!, "POST", { body: { title: `Probe ${MARK}`, leadId: leadB } });
      assert.ok([400, 404].includes(t.status), `task got ${t.status}`);
      const p = await call(proposals.POST!, "POST", { body: { value: 1, linkedPropertyId: propertyB } });
      assert.ok([400, 404].includes(p.status), `proposal got ${p.status}`);
      assert.equal(await prisma.task.count({ where: { workspaceId: A.workspaceId, title: `Probe ${MARK}` } }), 0);
    });

    it("POST /api/leads/:id/assign cannot assign A's lead to B's user, nor touch B's lead", async () => {
      const assign = await import("../../src/app/api/leads/[id]/assign/route");
      const ownLead = await prisma.lead.create({ data: { workspaceId: A.workspaceId, firstName: "Own" } });
      actAs(A.users.MANAGER);
      const toForeignUser = await call(assign.POST!, "POST", { params: { id: ownLead.id }, body: { ownerId: B.users.AGENT.id } });
      assert.ok([400, 403, 404].includes(toForeignUser.status), `got ${toForeignUser.status}`);
      const foreignLead = await call(assign.POST!, "POST", { params: { id: leadB }, body: { ownerId: A.users.AGENT.id } });
      assert.equal(foreignLead.status, 404);
      assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: ownLead.id } })).ownerId, null);
      assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: leadB } })).ownerId, null);
    });
  });

  describe("aggregate, export, search and membership endpoints", () => {
    it("GET /api/leads/csv export contains only the caller's workspace", async () => {
      const csv = await import("../../src/app/api/leads/csv/route");
      await prisma.lead.create({ data: { workspaceId: B.workspaceId, firstName: "CsvB", lastName: `${MARK}csv` } });
      await prisma.lead.create({ data: { workspaceId: A.workspaceId, firstName: "CsvA", lastName: `${MARK}own` } });
      actAs(A.users.OWNER);
      const res = await call(csv.GET!, "GET");
      assert.equal(res.status, 200);
      assert.ok(String(res.body).includes(`${MARK}own`));
      assert.ok(!String(res.body).includes(`${MARK}csv`));
    });

    it("VIEWER cannot export CSV", async () => {
      const csv = await import("../../src/app/api/leads/csv/route");
      actAs(A.users.VIEWER);
      assert.equal((await call(csv.GET!, "GET")).status, 403);
    });

    it("GET /api/search never returns another workspace's rows", async () => {
      const search = await import("../../src/app/api/search/route");
      for (const role of ROLES) {
        actAs(A.users[role]);
        const res = await call(search.GET!, "GET", { query: `?q=${MARK}` });
        assert.equal(res.status, 200);
        assert.ok(!JSON.stringify(res.body).includes(B.workspaceId));
        // B's seeded records all carry MARK in a name; none of B's ids may appear.
        const bIds = [
          ...(await prisma.lead.findMany({ where: { workspaceId: B.workspaceId }, select: { id: true } })),
          ...(await prisma.account.findMany({ where: { workspaceId: B.workspaceId }, select: { id: true } })),
          ...(await prisma.property.findMany({ where: { workspaceId: B.workspaceId }, select: { id: true } })),
        ].map((r) => r.id);
        const text = JSON.stringify(res.body);
        for (const id of bIds) assert.ok(!text.includes(id), `B record ${id} leaked into search`);
      }
    });

    it("GET /api/dashboard, /api/audit and /api/pipeline/stages only reflect the caller's workspace", async () => {
      const dashboard = await import("../../src/app/api/dashboard/route");
      const audit = await import("../../src/app/api/audit/route");
      const stages = await import("../../src/app/api/pipeline/stages/route");
      await prisma.auditLog.create({
        data: { workspaceId: B.workspaceId, action: "LEAD_CREATED", entity: "Lead", entityId: `${MARK}audit` },
      });
      actAs(A.users.OWNER);
      assert.equal((await call(dashboard.GET!, "GET")).status, 200);
      const auditRes = await call(audit.GET!, "GET");
      assert.equal(auditRes.status, 200);
      assert.ok(!JSON.stringify(auditRes.body).includes(`${MARK}audit`));
      const stagesRes = await call(stages.GET!, "GET");
      const text = JSON.stringify(stagesRes.body);
      for (const id of Object.values(B.stages)) assert.ok(!text.includes(id));
      for (const id of Object.values(A.stages)) assert.ok(text.includes(id));
    });

    it("OWNER of A cannot change or remove B's members (404), and B's roles are unchanged", async () => {
      const member = await import("../../src/app/api/workspace/members/[userId]/route");
      actAs(A.users.OWNER);
      const targetId = B.users.AGENT.id;
      const patch = await call(member.PATCH!, "PATCH", { params: { userId: targetId }, body: { role: "ADMIN" } });
      assert.equal(patch.status, 404);
      const del = await call(member.DELETE!, "DELETE", { params: { userId: targetId } });
      assert.equal(del.status, 404);
      const row = await prisma.workspaceMember.findUniqueOrThrow({
        where: { workspaceId_userId: { workspaceId: B.workspaceId, userId: targetId } },
      });
      assert.equal(row.role, "AGENT");
    });
  });

  describe("session / membership boundary", () => {
    it("unauthenticated requests get 401", async () => {
      const leads = await import("../../src/app/api/leads/route");
      actAs(null);
      assert.equal((await call(leads.GET!, "GET")).status, 401);
    });

    it("a user cannot act in a workspace they are not a member of, even with a forged workspaceId claim", async () => {
      const leads = await import("../../src/app/api/leads/route");
      const opp = await import("../../src/app/api/opportunities/[id]/route");
      const oppB = await resources[4].create(B);
      for (const role of ROLES) {
        actAs({ ...A.users[role], workspaceId: B.workspaceId });
        assert.equal((await call(leads.GET!, "GET")).status, 403, `${role} list`);
        assert.equal((await call(opp.GET!, "GET", { params: { id: oppB } })).status, 403, `${role} read`);
        assert.equal((await call(opp.DELETE!, "DELETE", { params: { id: oppB } })).status, 403, `${role} delete`);
      }
      assert.equal((await prisma.opportunity.findUniqueOrThrow({ where: { id: oppB } })).deletedAt, null);
    });

    it("a non-member's request for B's data cannot be satisfied by creating records either", async () => {
      const leads = await import("../../src/app/api/leads/route");
      actAs({ ...A.users.OWNER, workspaceId: B.workspaceId });
      const res = await call(leads.POST!, "POST", { body: { firstName: `Forged${MARK}` } });
      assert.equal(res.status, 403);
      assert.equal(await prisma.lead.count({ where: { firstName: `Forged${MARK}` } }), 0);
    });
  });
});
