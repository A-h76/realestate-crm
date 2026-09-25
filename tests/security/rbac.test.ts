import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { memberChangeDenial, permissionsForRole, roleHasPermission } from "../../src/lib/authz";

describe("RBAC permission matrix", () => {
  it("OWNER has every permission", () => {
    for (const permission of permissionsForRole("OWNER")) {
      assert.equal(roleHasPermission("OWNER", permission), true);
    }
    assert.equal(roleHasPermission("OWNER", "demo:reset"), true);
    assert.equal(roleHasPermission("OWNER", "workspace:write"), true);
    assert.equal(roleHasPermission("OWNER", "audit:read"), true);
  });

  it("ADMIN can manage CRM, CSV, automations, audit, and workspace", () => {
    assert.equal(roleHasPermission("ADMIN", "crm:write"), true);
    assert.equal(roleHasPermission("ADMIN", "csv:export"), true);
    assert.equal(roleHasPermission("ADMIN", "automations:execute"), true);
    assert.equal(roleHasPermission("ADMIN", "audit:read"), true);
    assert.equal(roleHasPermission("ADMIN", "workspace:write"), true);
    assert.equal(roleHasPermission("ADMIN", "intelligence:review"), true);
  });

  it("AGENT can run normal CRM workflows but not settings, audit, or automations execute", () => {
    assert.equal(roleHasPermission("AGENT", "crm:read"), true);
    assert.equal(roleHasPermission("AGENT", "crm:write"), true);
    assert.equal(roleHasPermission("AGENT", "crm:delete"), true);
    assert.equal(roleHasPermission("AGENT", "csv:import"), true);
    assert.equal(roleHasPermission("AGENT", "whatsapp:send"), true);
    assert.equal(roleHasPermission("AGENT", "intelligence:run"), true);
    assert.equal(roleHasPermission("AGENT", "workspace:write"), false);
    assert.equal(roleHasPermission("AGENT", "audit:read"), false);
    assert.equal(roleHasPermission("AGENT", "automations:execute"), false);
    assert.equal(roleHasPermission("AGENT", "demo:reset"), false);
    assert.equal(roleHasPermission("AGENT", "intelligence:review"), false);
    assert.equal(roleHasPermission("AGENT", "leads:assign"), false);
    assert.equal(roleHasPermission("AGENT", "members:manage"), false);
  });

  it("OWNER and ADMIN can assign leads and manage members", () => {
    for (const role of ["OWNER", "ADMIN"] as const) {
      assert.equal(roleHasPermission(role, "leads:assign"), true);
      assert.equal(roleHasPermission(role, "members:manage"), true);
    }
  });

  it("MANAGER runs the whole sales workflow plus team operations", () => {
    for (const permission of permissionsForRole("AGENT")) {
      assert.equal(roleHasPermission("MANAGER", permission), true, `MANAGER should inherit ${permission}`);
    }
    assert.equal(roleHasPermission("MANAGER", "leads:assign"), true);
    assert.equal(roleHasPermission("MANAGER", "audit:read"), true);
    assert.equal(roleHasPermission("MANAGER", "intelligence:review"), true);
    assert.equal(roleHasPermission("MANAGER", "automations:execute"), true);
  });

  it("MANAGER does not get workspace-owner privileges", () => {
    assert.equal(roleHasPermission("MANAGER", "workspace:write"), false);
    assert.equal(roleHasPermission("MANAGER", "members:manage"), false);
    assert.equal(roleHasPermission("MANAGER", "automations:manage"), false);
    assert.equal(roleHasPermission("MANAGER", "demo:reset"), false);
  });

  it("VIEWER is read-only and cannot mutate, export CSV, run automations, or read audit", () => {
    assert.equal(roleHasPermission("VIEWER", "crm:read"), true);
    assert.equal(roleHasPermission("VIEWER", "crm:write"), false);
    assert.equal(roleHasPermission("VIEWER", "crm:delete"), false);
    assert.equal(roleHasPermission("VIEWER", "csv:export"), false);
    assert.equal(roleHasPermission("VIEWER", "csv:import"), false);
    assert.equal(roleHasPermission("VIEWER", "automations:execute"), false);
    assert.equal(roleHasPermission("VIEWER", "audit:read"), false);
    assert.equal(roleHasPermission("VIEWER", "intelligence:run"), false);
    assert.equal(roleHasPermission("VIEWER", "workspace:write"), false);
    assert.equal(roleHasPermission("VIEWER", "whatsapp:send"), false);
  });
});

describe("Team member management rules", () => {
  const base = { actorId: "u_owner", actorRole: "OWNER" as const, targetId: "u_agent", targetRole: "AGENT" as const };

  it("lets the owner change an agent's role", () => {
    assert.equal(memberChangeDenial({ ...base, newRole: "MANAGER" }), null);
    assert.equal(memberChangeDenial({ ...base, newRole: "ADMIN" }), null);
  });

  it("never lets anyone edit their own membership", () => {
    assert.ok(memberChangeDenial({ ...base, targetId: "u_owner", targetRole: "OWNER", newRole: "AGENT" }));
    assert.ok(memberChangeDenial({ ...base, actorRole: "ADMIN", actorId: "u_admin", targetId: "u_admin", targetRole: "ADMIN" }));
  });

  it("protects the owner membership and never assigns OWNER", () => {
    assert.ok(memberChangeDenial({ ...base, actorRole: "ADMIN", actorId: "u_admin", targetId: "u_owner", targetRole: "OWNER" }));
    assert.ok(memberChangeDenial({ ...base, newRole: "OWNER" }));
  });

  it("only the owner may grant or change ADMIN", () => {
    const admin = { ...base, actorRole: "ADMIN" as const, actorId: "u_admin" };
    assert.equal(memberChangeDenial({ ...admin, newRole: "MANAGER" }), null);
    assert.ok(memberChangeDenial({ ...admin, newRole: "ADMIN" }));
    assert.ok(memberChangeDenial({ ...admin, targetId: "u_admin2", targetRole: "ADMIN", newRole: "AGENT" }));
  });

  it("refuses MANAGER, AGENT and VIEWER outright", () => {
    for (const actorRole of ["MANAGER", "AGENT", "VIEWER"] as const) {
      assert.ok(memberChangeDenial({ ...base, actorRole, actorId: "u_x", newRole: "VIEWER" }));
    }
  });
});
