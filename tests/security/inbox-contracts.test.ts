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
    const page = read("src/app/(app)/whatsapp/page.tsx");
    assert.ok(page.includes("session.user.workspaceId"));
    assert.equal(page.includes("searchParams.workspaceId"), false);
  });

  it("scopes the conversation detail fetch by workspaceId (existing provider abstraction, unchanged)", () => {
    const route = read("src/app/api/whatsapp/conversations/[id]/route.ts");
    assert.ok(route.includes('requirePermission("whatsapp:read")'));
    assert.ok(route.includes("provider.getThread(workspaceId"));
  });
});

describe("WhatsApp Inbox — take-over action", () => {
  it("requires crm:write and scopes every mutation by workspaceId", () => {
    const route = read("src/app/api/leads/[id]/take-over/route.ts");
    assert.ok(route.includes('requirePermission("crm:write")'));
    assert.ok(route.includes("prisma.lead.findFirst({ where: { id, workspaceId, deletedAt: null } })"));
    assert.ok(route.includes("prisma.lead.updateMany({\n        where: { id, workspaceId }"));
    assert.ok(route.includes("prisma.task.updateMany({"));
    assert.ok(route.includes("leadId: id,"));
  });

  it("404s a lead outside the caller's workspace instead of leaking existence", () => {
    const route = read("src/app/api/leads/[id]/take-over/route.ts");
    assert.ok(route.includes('throw new ApiError(404, "Lead not found")'));
  });

  it("writes an audit entry for the ownership change", () => {
    const route = read("src/app/api/leads/[id]/take-over/route.ts");
    assert.ok(route.includes('action: "LEAD_UPDATED"'));
    assert.ok(route.includes("handoff_take_over"));
  });

  it("reuses the existing handoff open-task statuses rather than a second definition", () => {
    const route = read("src/app/api/leads/[id]/take-over/route.ts");
    const inbox = read("src/lib/whatsapp/inbox.ts");
    assert.ok(route.includes('import { OPEN_TASK_STATUSES } from "@/lib/whatsapp/handoff-event"'));
    assert.ok(inbox.includes('import { OPEN_TASK_STATUSES } from "./handoff-event"'));
  });
});
