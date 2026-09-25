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
  // Route does auth + 404; the shared takeOverLead() (also used by the UX demo seed) does the writes.
  const route = () => read("src/app/api/leads/[id]/take-over/route.ts");
  const lib = () => read("src/lib/leads/take-over.ts");

  it("requires crm:write and scopes every mutation by workspaceId", () => {
    assert.ok(route().includes('requirePermission("crm:write")'));
    assert.ok(route().includes("takeOverLead(workspaceId, id, userId)"));
    assert.ok(lib().includes("prisma.lead.findFirst({ where: { id: leadId, workspaceId, deletedAt: null } })"));
    assert.ok(lib().includes("prisma.lead.updateMany({\n    where: { id: leadId, workspaceId }"));
    assert.ok(lib().includes("prisma.task.updateMany({\n    where: {\n      workspaceId,\n      leadId,"));
  });

  it("404s a lead outside the caller's workspace instead of leaking existence", () => {
    assert.ok(lib().includes("if (!lead) return null;"));
    assert.ok(route().includes('if (!result) throw new ApiError(404, "Lead not found")'));
  });

  it("writes an audit entry for the ownership change", () => {
    assert.ok(lib().includes('action: "LEAD_UPDATED"'));
    assert.ok(lib().includes("handoff_take_over"));
  });

  it("reuses the existing handoff open-task statuses rather than a second definition", () => {
    const inbox = read("src/lib/whatsapp/inbox.ts");
    assert.ok(lib().includes('import { OPEN_TASK_STATUSES } from "@/lib/whatsapp/handoff-event"'));
    assert.ok(inbox.includes('import { OPEN_TASK_STATUSES } from "./handoff-event"'));
  });
});
