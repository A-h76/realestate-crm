import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { permissionsForRole, roleHasPermission } from "../../src/lib/authz";

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
