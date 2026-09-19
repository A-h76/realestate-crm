import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "../..");

function read(relative: string) {
  return readFileSync(join(root, relative), "utf8");
}

describe("Source security contracts", () => {
  it("reloads membership role from the database rather than trusting JWT role", () => {
    const api = read("src/lib/api.ts");
    assert.ok(api.includes("prisma.workspaceMember.findUnique"));
    assert.ok(api.includes("role: membership.role"));
  });

  it("validates related record IDs against the authenticated workspace", () => {
    const tenant = read("src/lib/tenant.ts");
    assert.ok(tenant.includes("export async function assertRelationsInWorkspace"));
    assert.ok(tenant.includes("accountId"));
    assert.ok(tenant.includes("contactId"));
    assert.ok(tenant.includes("ownerId"));
    assert.ok(tenant.includes("leadId"));
    assert.ok(tenant.includes("propertyId"));
    assert.ok(tenant.includes("opportunityId"));
  });

  it("does not map webhook workspace from attacker-controlled payload fields", () => {
    const webhook = read("src/lib/webhooks/whatsapp.ts");
    assert.equal(webhook.includes("payload.workspaceId"), false);
    assert.ok(webhook.includes("phoneNumberId"));
    assert.ok(webhook.includes("verifyHubSignature256"));
  });

  it("scopes lead activity updates by workspace", () => {
    const tenant = read("src/lib/tenant.ts");
    assert.ok(tenant.includes("updateMany"));
    assert.ok(tenant.includes("id: leadId, workspaceId"));
  });
});
