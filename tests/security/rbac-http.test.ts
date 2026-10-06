import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { WorkspaceRole } from "@prisma/client";
import { prisma } from "../../src/lib/db";
import { actAs, call, createTenant, destroyTenant, installSessionMock, ROLES, type Tenant } from "../helpers/http";

/**
 * TEST-002: every role against representative read / create / update / delete / export / membership /
 * administrative operations, through the real route handlers. The expected-access table below is written
 * out by hand from README.md "Roles" and is deliberately NOT derived from src/lib/authz.ts, so a change
 * to the permission matrix has to be made here too.
 *
 * "Allowed" means the request got past authorization: the probe bodies are intentionally invalid or point
 * at nothing, so allowed requests end in 400/404 (or 200 for plain reads) and denied ones in 403.
 * Workspace restrictions are covered in tenant-isolation-http.test.ts.
 */
type Handler = Parameters<typeof call>[0];
type Op = {
  name: string;
  allowed: WorkspaceRole[];
  run: (t: Tenant) => Promise<{ status: number }>;
};

const ALL: WorkspaceRole[] = ["OWNER", "ADMIN", "MANAGER", "AGENT", "VIEWER"];
const SALES: WorkspaceRole[] = ["OWNER", "ADMIN", "MANAGER", "AGENT"]; // everyone who can change CRM data
const MANAGERS: WorkspaceRole[] = ["OWNER", "ADMIN", "MANAGER"];
const ADMINS: WorkspaceRole[] = ["OWNER", "ADMIN"];

const load = async (path: string): Promise<Record<string, Handler>> => import(path);

describe("RBAC at the HTTP boundary", () => {
  let tenant: Tenant;
  let ops: Op[];

  before(async () => {
    installSessionMock();
    tenant = await createTenant("rbac");
    const leads = await load("../../src/app/api/leads/route");
    const lead = await load("../../src/app/api/leads/[id]/route");
    const assign = await load("../../src/app/api/leads/[id]/assign/route");
    const csv = await load("../../src/app/api/leads/csv/route");
    const opps = await load("../../src/app/api/opportunities/route");
    const tasks = await load("../../src/app/api/tasks/route");
    const calendar = await load("../../src/app/api/calendar/route");
    const wa = await load("../../src/app/api/whatsapp/messages/route");
    const waConv = await load("../../src/app/api/whatsapp/conversations/[id]/route");
    const intel = await load("../../src/app/api/intelligence/route");
    const review = await load("../../src/app/api/intelligence/review/route");
    const scoring = await load("../../src/app/api/scoring/route");
    const automations = await load("../../src/app/api/automations/route");
    const audit = await load("../../src/app/api/audit/route");
    const members = await load("../../src/app/api/workspace/members/route");
    const member = await load("../../src/app/api/workspace/members/[userId]/route");
    const workspace = await load("../../src/app/api/workspace/route");
    const sources = await load("../../src/app/api/workspace/sources/route");
    const search = await load("../../src/app/api/search/route");
    const notifications = await load("../../src/app/api/notifications/route");
    const missing = { params: { id: "does-not-exist" } };

    ops = [
      { name: "read leads (GET /api/leads)", allowed: ALL, run: () => call(leads.GET, "GET") },
      { name: "read opportunities", allowed: ALL, run: () => call(opps.GET, "GET") },
      { name: "read audit log", allowed: MANAGERS, run: () => call(audit.GET, "GET") },
      { name: "read automations", allowed: ALL, run: () => call(automations.GET, "GET") },
      { name: "read notifications", allowed: ALL, run: () => call(notifications.GET, "GET") },
      { name: "search", allowed: ALL, run: () => call(search.GET, "GET", { query: "?q=a" }) },
      { name: "read workspace settings", allowed: ALL, run: () => call(workspace.GET, "GET") },
      { name: "read lead source coverage", allowed: ALL, run: () => call(sources.GET, "GET") },
      { name: "read a WhatsApp conversation", allowed: ALL, run: () => call(waConv.GET, "GET", missing) },

      { name: "create lead", allowed: SALES, run: () => call(leads.POST, "POST", { body: {} }) },
      { name: "create opportunity", allowed: SALES, run: () => call(opps.POST, "POST", { body: {} }) },
      { name: "create task", allowed: SALES, run: () => call(tasks.POST, "POST", { body: {} }) },
      { name: "create calendar event", allowed: SALES, run: () => call(calendar.POST, "POST", { body: {} }) },
      { name: "send WhatsApp message", allowed: SALES, run: () => call(wa.POST, "POST", { body: {} }) },

      { name: "update lead", allowed: SALES, run: () => call(lead.PATCH, "PATCH", { ...missing, body: { firstName: "x" } }) },
      { name: "delete lead", allowed: SALES, run: () => call(lead.DELETE, "DELETE", missing) },

      { name: "export leads CSV", allowed: SALES, run: () => call(csv.GET, "GET") },
      { name: "import leads CSV", allowed: SALES, run: () => call(csv.POST, "POST", { rawBody: "" }) },

      { name: "assign a lead to someone", allowed: MANAGERS, run: () => call(assign.POST, "POST", { ...missing, body: {} }) },
      { name: "run AI/intelligence", allowed: SALES, run: () => call(intel.POST, "POST", { body: {} }) },
      { name: "review AI output", allowed: MANAGERS, run: () => call(review.POST, "POST", { body: {} }) },
      { name: "run lead scoring", allowed: SALES, run: () => call(scoring.POST, "POST", { body: {} }) },
      { name: "run inactive-lead automations", allowed: MANAGERS, run: () => call(automations.POST, "POST") },
      { name: "pause/enable an automation", allowed: ADMINS, run: () => call(automations.PATCH, "PATCH", { body: {} }) },

      { name: "add a team member", allowed: ADMINS, run: () => call(members.POST, "POST", { body: {} }) },
      { name: "change a member's role", allowed: ADMINS, run: () => call(member.PATCH, "PATCH", { params: { userId: "nobody" }, body: { role: "AGENT" } }) },
      { name: "remove a member", allowed: ADMINS, run: () => call(member.DELETE, "DELETE", { params: { userId: "nobody" } }) },
      { name: "edit workspace settings / branding", allowed: ADMINS, run: () => call(workspace.PATCH, "PATCH", { body: {} }) },
      { name: "declare lead sources", allowed: ADMINS, run: () => call(sources.PUT, "PUT", { body: {} }) },
    ];
  });

  after(async () => {
    await destroyTenant(tenant);
  });

  for (const role of ROLES) {
    it(`${role}: every operation is allowed or denied exactly as documented`, async () => {
      const wrong: string[] = [];
      actAs(tenant.users[role]);
      for (const op of ops) {
        const { status } = await op.run(tenant);
        const shouldAllow = op.allowed.includes(role);
        if (status === 401) wrong.push(`${op.name}: got 401 for an authenticated user`);
        else if (shouldAllow && status === 403) wrong.push(`${op.name}: ${role} should be allowed but got 403`);
        else if (!shouldAllow && status !== 403) wrong.push(`${op.name}: ${role} should be denied (403) but got ${status}`);
        else if (status >= 500) wrong.push(`${op.name}: server error ${status}`);
      }
      assert.deepEqual(wrong, []);
    });
  }

  it("no operation is reachable without a session (401)", async () => {
    actAs(null);
    for (const op of ops) assert.equal((await op.run(tenant)).status, 401, op.name);
  });

  it("the matrix covers every role and every operation has at least one allowed and (except plain reads) one denied role", () => {
    for (const op of ops) {
      assert.ok(op.allowed.length > 0, op.name);
      if (!op.name.startsWith("read") && op.name !== "search") assert.ok(op.allowed.length < ROLES.length, `${op.name} should deny someone`);
    }
  });

  describe("membership guards (privilege escalation)", () => {
    const patch = async (actor: WorkspaceRole, target: WorkspaceRole, role: string) => {
      const member = await load("../../src/app/api/workspace/members/[userId]/route");
      actAs(tenant.users[actor]);
      return call(member.PATCH, "PATCH", { params: { userId: tenant.users[target].id }, body: { role } });
    };

    it("nobody can change their own role", async () => {
      for (const role of ADMINS) assert.equal((await patch(role, role, "AGENT")).status, 403, role);
    });

    it("an ADMIN cannot touch the OWNER or grant ADMIN", async () => {
      assert.equal((await patch("ADMIN", "OWNER", "AGENT")).status, 403);
      assert.equal((await patch("ADMIN", "AGENT", "ADMIN")).status, 403);
      assert.equal((await prisma.workspaceMember.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: tenant.workspaceId, userId: tenant.users.OWNER.id } } })).role, "OWNER");
    });

    it("an ADMIN cannot remove the OWNER; the OWNER can remove an AGENT", async () => {
      const member = await load("../../src/app/api/workspace/members/[userId]/route");
      actAs(tenant.users.ADMIN);
      assert.equal((await call(member.DELETE, "DELETE", { params: { userId: tenant.users.OWNER.id } })).status, 403);
      const extra = await prisma.user.create({ data: { email: `rbac-extra-${Date.now()}@example.test`, name: "Extra", passwordHash: "x" } });
      await prisma.workspaceMember.create({ data: { workspaceId: tenant.workspaceId, userId: extra.id, role: "AGENT" } });
      actAs(tenant.users.OWNER);
      assert.equal((await call(member.DELETE, "DELETE", { params: { userId: extra.id } })).status, 200);
      await prisma.user.delete({ where: { id: extra.id } });
    });

    it("OWNER cannot be assigned through the API role list", async () => {
      const members = await load("../../src/app/api/workspace/members/route");
      actAs(tenant.users.OWNER);
      const res = await call(members.POST, "POST", { body: { email: `x-${Date.now()}@example.test`, name: "X", role: "OWNER" } });
      assert.equal(res.status, 400);
    });

    it("a removed member's next request is refused", async () => {
      const member = await load("../../src/app/api/workspace/members/[userId]/route");
      const leads = await load("../../src/app/api/leads/route");
      const extra = await prisma.user.create({ data: { email: `rbac-gone-${Date.now()}@example.test`, name: "Gone", passwordHash: "x" } });
      await prisma.workspaceMember.create({ data: { workspaceId: tenant.workspaceId, userId: extra.id, role: "AGENT" } });
      const asExtra = { id: extra.id, email: extra.email, name: extra.name, workspaceId: tenant.workspaceId, role: "AGENT" as const };
      actAs(asExtra);
      assert.equal((await call(leads.GET, "GET")).status, 200);
      actAs(tenant.users.OWNER);
      assert.equal((await call(member.DELETE, "DELETE", { params: { userId: extra.id } })).status, 200);
      actAs(asExtra);
      assert.equal((await call(leads.GET, "GET")).status, 403);
      await prisma.user.delete({ where: { id: extra.id } });
    });
  });
});
