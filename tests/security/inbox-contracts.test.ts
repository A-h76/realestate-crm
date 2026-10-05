import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "../..");

function read(relative: string) {
  return readFileSync(join(root, relative), "utf8");
}

describe("WhatsApp Inbox — workspace isolation", () => {
  it("scopes the conversation list query by the authenticated workspace, not a client-supplied one", () => {
    const inbox = read("src/lib/whatsapp/inbox.ts");
    assert.ok(inbox.includes("listConversations(workspaceId: string)"));
    assert.ok(inbox.includes("prisma.whatsAppMessage.findMany({\n    where: { workspaceId }"));
    assert.ok(inbox.includes("prisma.lead.findMany({\n      where: { id: { in: leadIds }, workspaceId"));
    assert.ok(inbox.includes("prisma.task.findMany({"));
  });

  it("derives workspaceId from requirePermission() rather than trusting a request body/param", () => {
    const page = read("src/app/(app)/conversations/page.tsx");
    // Membership-checked DAL, not the JWT claim (see docs/security F-01).
    assert.ok(page.includes("const { workspaceId, userId } = await requireAppAccess();"));
    assert.equal(page.includes("searchParams.workspaceId"), false);
  });

  it("scopes the conversation detail fetch by workspaceId (existing provider abstraction, unchanged)", () => {
    const route = read("src/app/api/whatsapp/conversations/[id]/route.ts");
    assert.ok(route.includes('requirePermission("whatsapp:read")'));
    assert.ok(route.includes("provider.getThread(workspaceId"));
  });
});
// Take-over behaviour (authorization, ownership rule, concurrency, idempotency, audit) is tested against a real database in take-over-http.test.ts.
