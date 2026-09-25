/**
 * Role + UX-flow E2E against a running app, using the UX audit demo users.
 * Checks server-side authorization for OWNER / MANAGER / AGENT (not just
 * hidden buttons), cross-workspace ID tampering, and walks Flows 5–9
 * through the real API. Restores the UX demo workspace when done.
 *
 * Requires: `npm run dev` (or start) with DEMO_MODE=true, a seeded UX demo
 * (`npm run db:seed:ux-audit`), and DEMO_SEED_PASSWORD in the environment.
 * Run: npm run e2e:rbac
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db";
import { seedUxAuditWorkspace, UX_AUDIT_WORKSPACE_ID as WS } from "../prisma/seed-ux-audit-data";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

async function login(email: string): Promise<string> {
  const password = process.env.DEMO_SEED_PASSWORD;
  if (!password) throw new Error("Set DEMO_SEED_PASSWORD before running e2e:rbac.");
  const csrf = await fetch(`${BASE}/api/auth/csrf`);
  const { csrfToken } = await csrf.json();
  const jar = new Map<string, string>();
  const keep = (res: Response) => {
    for (const c of res.headers.getSetCookie()) {
      const part = c.split(";")[0];
      jar.set(part.slice(0, part.indexOf("=")), part);
    }
  };
  keep(csrf);
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: [...jar.values()].join("; ") },
    body: new URLSearchParams({ csrfToken, email, password, callbackUrl: `${BASE}/dashboard`, json: "true" }),
    redirect: "manual",
  });
  keep(res);
  const cookie = [...jar.values()].join("; ");
  const session = await fetch(`${BASE}/api/auth/session`, { headers: { Cookie: cookie } }).then((r) => r.json());
  if (session?.user?.email !== email) throw new Error(`Login failed for ${email}`);
  return cookie;
}

async function call(cookie: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

let failures = 0;
async function expectStatus(label: string, cookie: string | null, method: string, path: string, body: unknown, expected: number | number[]) {
  const { status, data } = await call(cookie, method, path, body);
  const ok = (Array.isArray(expected) ? expected : [expected]).includes(status);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: ${method} ${path} -> ${status}`);
  if (!ok) {
    failures += 1;
    console.log(`      expected ${expected}, body ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data;
}

const leadByPhone = (n: number) =>
  prisma.lead.findFirstOrThrow({ where: { workspaceId: WS, whatsappNumber: `+9239900001${String(n).padStart(2, "0")}` } });

async function main() {
  const owner = await login("ux-owner@demo.synaslabs.com");
  const manager = await login("ux-manager@demo.synaslabs.com");
  const agent = await login("ux-agent@demo.synaslabs.com");

  // A foreign workspace + lead, to prove IDs from another tenant are rejected.
  const foreign = await prisma.workspace.create({ data: { name: "E2E foreign", slug: `e2e-foreign-${randomUUID()}` } });
  const foreignLead = await prisma.lead.create({ data: { workspaceId: foreign.id, firstName: "Foreign" } });
  const foreignUser = await prisma.user.create({ data: { email: `foreign-${randomUUID()}@example.com`, name: "Foreign", passwordHash: "x" } });
  await prisma.workspaceMember.create({ data: { workspaceId: foreign.id, userId: foreignUser.id, role: "AGENT" } });

  try {
    const usman = await leadByPhone(1);
    const kamran = await leadByPhone(3);
    const faisal = await leadByPhone(5);
    const automation = await prisma.automation.findFirstOrThrow({ where: { workspaceId: WS } });

    console.log("\n-- unauthenticated");
    await expectStatus("anonymous API call", null, "GET", "/api/leads", undefined, [401, 302, 307]);

    console.log("\n-- everyone can work the CRM");
    for (const [name, cookie] of [["owner", owner], ["manager", manager], ["agent", agent]] as const) {
      await expectStatus(`${name} lists leads`, cookie, "GET", "/api/leads", undefined, 200);
      await expectStatus(`${name} reads dashboard`, cookie, "GET", "/api/dashboard", undefined, 200);
      await expectStatus(`${name} reads a WhatsApp thread`, cookie, "GET", `/api/whatsapp/conversations/${encodeURIComponent(`lead:${usman.id}`)}`, undefined, 200);
    }

    console.log("\n-- workspace-owner privileges");
    const ws = await call(owner, "GET", "/api/workspace");
    const branding = { companyName: ws.data.branding.companyName };
    await expectStatus("owner edits branding", owner, "PATCH", "/api/workspace", branding, 200);
    await expectStatus("manager cannot edit branding", manager, "PATCH", "/api/workspace", branding, 403);
    await expectStatus("agent cannot edit branding", agent, "PATCH", "/api/workspace", branding, 403);
    await expectStatus("manager cannot reset demo", manager, "POST", "/api/demo/reset", undefined, 403);
    await expectStatus("agent cannot reset demo", agent, "POST", "/api/demo/reset", undefined, 403);
    await expectStatus("owner manages automations", owner, "PATCH", "/api/automations", { id: automation.id, paused: false }, 200);
    await expectStatus("manager cannot manage automations", manager, "PATCH", "/api/automations", { id: automation.id, paused: true }, 403);
    await expectStatus("agent cannot manage automations", agent, "PATCH", "/api/automations", { id: automation.id, paused: true }, 403);
    await expectStatus("owner reads audit log", owner, "GET", "/api/audit", undefined, 200);
    await expectStatus("manager reads audit log", manager, "GET", "/api/audit", undefined, 200);
    await expectStatus("agent cannot read audit log", agent, "GET", "/api/audit", undefined, 403);

    console.log("\n-- team management");
    await expectStatus("manager cannot change roles", manager, "PATCH", "/api/workspace/members/user_ux_agent", { role: "VIEWER" }, 403);
    await expectStatus("agent cannot change roles", agent, "PATCH", "/api/workspace/members/user_ux_manager", { role: "AGENT" }, 403);
    await expectStatus("owner cannot edit own membership", owner, "PATCH", "/api/workspace/members/user_ux_owner", { role: "AGENT" }, 403);
    await expectStatus("owner cannot assign OWNER", owner, "PATCH", "/api/workspace/members/user_ux_agent", { role: "OWNER" }, 400);
    await expectStatus("owner promotes agent to manager", owner, "PATCH", "/api/workspace/members/user_ux_agent", { role: "MANAGER" }, 200);
    await expectStatus("owner restores agent role", owner, "PATCH", "/api/workspace/members/user_ux_agent", { role: "AGENT" }, 200);
    await expectStatus("owner cannot touch another workspace's member", owner, "PATCH", `/api/workspace/members/${foreignUser.id}`, { role: "VIEWER" }, 404);

    console.log("\n-- lead assignment");
    await expectStatus("agent cannot assign", agent, "POST", `/api/leads/${usman.id}/assign`, { ownerId: "user_ux_agent" }, 403);
    await expectStatus("agent cannot reassign via PATCH", agent, "PATCH", `/api/leads/${usman.id}`, { ownerId: "user_ux_manager" }, 403);
    await expectStatus("agent cannot create a lead for someone else", agent, "POST", "/api/leads", { firstName: "E2E", ownerId: "user_ux_manager" }, 403);
    await expectStatus("manager cannot assign to a foreign user", manager, "POST", `/api/leads/${usman.id}/assign`, { ownerId: foreignUser.id }, 400);
    await expectStatus("manager assigns new lead to agent", manager, "POST", `/api/leads/${usman.id}/assign`, { ownerId: "user_ux_agent" }, 200);

    console.log("\n-- cross-workspace ID tampering");
    await expectStatus("read foreign lead", agent, "GET", `/api/leads/${foreignLead.id}`, undefined, 404);
    await expectStatus("update foreign lead", agent, "PATCH", `/api/leads/${foreignLead.id}`, { firstName: "Hacked" }, 404);
    await expectStatus("take over foreign lead", agent, "POST", `/api/leads/${foreignLead.id}/take-over`, undefined, 404);
    await expectStatus("link foreign lead to opportunity", agent, "POST", "/api/opportunities", { name: "x", dealSide: "BUYER", value: 1, stageId: "ux_stage_new", leadId: foreignLead.id }, 400);
    await expectStatus("assign foreign lead", manager, "POST", `/api/leads/${foreignLead.id}/assign`, { ownerId: "user_ux_agent" }, 404);
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: foreignLead.id } })).firstName, "Foreign");

    console.log("\n-- AGENT walks the sales flows");
    const takeOver = await expectStatus("Flow 5: agent takes over handoff", agent, "POST", `/api/leads/${faisal.id}/take-over`, undefined, 200);
    assert.ok(takeOver.handoffTasksClaimed >= 1, "handoff task claimed");
    await expectStatus("Flow 5: agent replies manually", agent, "POST", "/api/whatsapp/messages", { conversationId: `lead:${faisal.id}`, leadId: faisal.id, body: "Ji, owner se confirm kar ke batata hoon." }, 201);

    const opp = await expectStatus("Flow 6: lead -> opportunity", agent, "POST", "/api/opportunities", { name: "Kamran Ashraf: DHA Phase 2 rent", dealSide: "BUYER", value: 576_000, stageId: "ux_stage_qualified", leadId: kamran.id, linkedPropertyId: "uxp_dha2_5m_rent_q" }, 201);
    await expectStatus("Flow 6: move to Discovery", agent, "PATCH", `/api/opportunities/${opp.id}`, { stageId: "ux_stage_discovery" }, 200);

    const start = new Date(Date.now() + 2 * 86_400_000);
    const visit = await expectStatus("Flow 7: schedule site visit", agent, "POST", "/api/calendar", { title: "Site visit: DHA Phase 2 Block Q", type: "SITE_VISIT", startAt: start, endAt: new Date(start.getTime() + 3_600_000), leadId: kamran.id, opportunityId: opp.id }, 201);
    await expectStatus("Flow 7: record visit outcome", agent, "PATCH", `/api/calendar/${visit.id ?? visit.event?.id}`, { status: "COMPLETED", notes: "Liked it." }, 200);

    const proposal = await expectStatus("Flow 8: create proposal", agent, "POST", "/api/proposals", { leadId: kamran.id, opportunityId: opp.id, linkedPropertyId: "uxp_dha2_5m_rent_q", value: 576_000 }, 201);
    for (const status of ["SENT", "VIEWED", "ACCEPTED"]) {
      await expectStatus(`Flow 8: proposal ${status}`, agent, "PATCH", `/api/proposals/${proposal.id}`, { status }, 200);
    }
    await expectStatus("Flow 9: opportunity won", agent, "PATCH", `/api/opportunities/${opp.id}`, { stageId: "ux_stage_won" }, 200);
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: kamran.id } })).stage, "CONVERTED", "won converts the lead");
    console.log("PASS  Flow 9: lead converted on won");
  } finally {
    await prisma.workspace.delete({ where: { id: foreign.id } });
    await prisma.user.delete({ where: { id: foreignUser.id } });
    console.log("\nRestoring the UX demo workspace…");
    delete process.env.OPENAI_API_KEY;
    await seedUxAuditWorkspace();
  }

  if (failures > 0) throw new Error(`${failures} check(s) failed`);
  console.log("\nAll RBAC and UX-flow checks passed.");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
