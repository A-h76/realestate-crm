/**
 * Golden Path E2E: Incoming Lead (simulated) -> Capture -> Intelligence -> Score
 * -> Assignment -> Property Match -> Follow-up -> Site Visit -> Qualification
 * -> Opportunity -> Proposal -> Accepted (simulated) -> Won -> Revenue + Audit.
 *
 * Requires DEMO_MODE=true (the simulate-inbound endpoint is demo-gated).
 * Run: npx tsx scripts/e2e-golden-path.ts
 */
import { PrismaClient } from "@prisma/client";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const prisma = new PrismaClient();

async function getCsrf() {
  const res = await fetch(`${BASE}/api/auth/csrf`);
  const data = await res.json();
  const cookie = res.headers.getSetCookie?.() ?? [];
  return { csrfToken: data.csrfToken as string, cookies: cookie };
}

function mergeCookies(existing: string[], incoming: string[]) {
  const map = new Map<string, string>();
  for (const list of [existing, incoming]) {
    for (const c of list) {
      const part = c.split(";")[0];
      const eq = part.indexOf("=");
      if (eq > 0) map.set(part.slice(0, eq), part);
    }
  }
  return [...map.values()];
}

async function login() {
  const password = process.env.DEMO_SEED_PASSWORD ?? process.env.E2E_PASSWORD ?? "";
  if (!password) {
    throw new Error("Set DEMO_SEED_PASSWORD or E2E_PASSWORD before running e2e.");
  }
  const { csrfToken, cookies } = await getCsrf();
  // /api/auth/csrf can set authjs.csrf-token twice; keep only the last one or Auth.js rejects the stale token (MissingCSRF).
  let jar = mergeCookies([], cookies);
  const body = new URLSearchParams({
    csrfToken,
    email: process.env.E2E_EMAIL ?? "ahmed@synaslabs.demo",
    password,
    callbackUrl: `${BASE}/dashboard`,
    json: "true",
  });
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: jar.map((c) => c.split(";")[0]).join("; "),
    },
    body,
    redirect: "manual",
  });
  jar = mergeCookies(jar, res.headers.getSetCookie?.() ?? []);
  const cookieHeader = jar.map((c) => c.split(";")[0]).join("; ");
  const session = await fetch(`${BASE}/api/auth/session`, {
    headers: { Cookie: cookieHeader },
  }).then((r) => r.json());
  if (!session?.user) throw new Error("Login failed");
  return { cookieHeader, user: session.user };
}

async function api(cookieHeader: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Cookie: cookieHeader,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function main() {
  console.log("Golden Path: login…");
  const { cookieHeader, user } = await login();

  const stages = await api(cookieHeader, "GET", "/api/pipeline/stages");
  const stageBySlug = Object.fromEntries(
    (stages.items as Array<{ id: string; slug: string }>).map((s) => [s.slug, s]),
  );

  console.log("Golden Path: 1. Incoming Lead — simulate Facebook Ad…");
  const inbound = await api(cookieHeader, "POST", "/api/leads/simulate-inbound");
  if (!inbound.demo) throw new Error("Expected demo notice on simulated inbound lead");
  if (inbound.lead.source !== "FACEBOOK_ADS") throw new Error("Simulated lead not sourced from FACEBOOK_ADS");
  const lead = inbound.lead;
  console.log("  lead", lead.id, inbound.notice);

  console.log("Golden Path: 2/3. Intelligence + Score…");
  const analysis = await api(cookieHeader, "POST", "/api/intelligence", {
    kind: "LEAD_ANALYSIS",
    leadId: lead.id,
  });
  if (!analysis.output?.recommendedAction) throw new Error("Lead analysis missing recommendedAction");
  const scored = await api(cookieHeader, "POST", "/api/scoring", { leadId: lead.id });
  if (typeof scored.lead?.leadScore !== "number") throw new Error("Scoring did not return leadScore");

  console.log("Golden Path: 4. Assignment — least-loaded agent…");
  const assignment = await api(cookieHeader, "POST", `/api/leads/${lead.id}/assign`);
  if (!assignment.assignment?.agentId) throw new Error("Assignment did not return an agentId");

  console.log("Golden Path: 5. Property Match…");
  const matches = await api(cookieHeader, "POST", "/api/intelligence", {
    kind: "PROPERTY_MATCH",
    leadId: lead.id,
  });
  if (!Array.isArray(matches.scored)) throw new Error("Property match missing scored results");
  const property =
    matches.scored[0]?.property ??
    (await prisma.property.findFirst({ where: { workspaceId: user.workspaceId, deletedAt: null } }));
  if (!property) throw new Error("No property available to link");

  console.log("Golden Path: 6. Follow-up — demo WhatsApp…");
  await api(cookieHeader, "POST", "/api/intelligence", { kind: "FOLLOW_UP_DRAFT", leadId: lead.id });
  const wa = await api(cookieHeader, "POST", "/api/whatsapp/messages", {
    conversationId: `lead:${lead.id}`,
    body: "Assalam o Alaikum — confirming your interest.",
    leadId: lead.id,
  });
  if (!wa.demo) throw new Error("Expected demo WhatsApp response");

  console.log("Golden Path: 7. Site Visit — demo Calendar…");
  const start = new Date(Date.now() + 36 * 3600000);
  const end = new Date(start.getTime() + 2 * 3600000);
  const cal = await api(cookieHeader, "POST", "/api/calendar", {
    title: "Golden Path Site Visit",
    type: "SITE_VISIT",
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    leadId: lead.id,
  });
  if (!cal.demo) throw new Error("Expected demo calendar response");

  console.log("Golden Path: 8. Qualification — agent confirms…");
  const qualified = await api(cookieHeader, "PATCH", `/api/leads/${lead.id}`, { stage: "QUALIFIED" });
  if (qualified.stage !== "QUALIFIED") throw new Error("Lead did not move to QUALIFIED");

  console.log("Golden Path: 9. Opportunity…");
  const opp = await api(cookieHeader, "POST", "/api/opportunities", {
    name: "Golden Path Opportunity",
    dealSide: "BUYER",
    value: Number(lead.estimatedValue ?? 42000000),
    currency: "PKR",
    stageId: stageBySlug.new.id,
    leadId: lead.id,
    linkedPropertyId: property.id,
  });

  console.log("Golden Path: 10. Proposal — sent…");
  await api(cookieHeader, "PATCH", `/api/opportunities/${opp.id}`, { stageId: stageBySlug.proposal.id });
  const proposal = await api(cookieHeader, "POST", "/api/proposals", {
    opportunityId: opp.id,
    leadId: lead.id,
    linkedPropertyId: property.id,
    value: Number(opp.value),
    status: "DRAFT",
  });
  await api(cookieHeader, "PATCH", `/api/proposals/${proposal.id}`, { status: "SENT" });

  console.log("Golden Path: 11. Accepted — simulate acceptance…");
  const accepted = await api(cookieHeader, "PATCH", `/api/proposals/${proposal.id}`, { status: "ACCEPTED" });
  if (accepted.status !== "ACCEPTED") throw new Error("Proposal did not move to ACCEPTED");

  const dashboardBefore = await api(cookieHeader, "GET", "/api/dashboard");

  console.log("Golden Path: 12. Won…");
  await api(cookieHeader, "PATCH", `/api/opportunities/${opp.id}`, { stageId: stageBySlug.won.id });
  const wonOpp = await prisma.opportunity.findUnique({ where: { id: opp.id }, include: { stage: true } });
  if (!wonOpp?.stage.isWon) throw new Error("Opportunity not in Won stage");

  console.log("Golden Path: 13. Revenue + Audit…");
  const dashboardAfter = await api(cookieHeader, "GET", "/api/dashboard");
  if (!(dashboardAfter.metrics.wonRevenue > dashboardBefore.metrics.wonRevenue)) {
    throw new Error("Dashboard wonRevenue did not increase after Won");
  }
  const audits = await prisma.auditLog.count({
    where: {
      workspaceId: user.workspaceId,
      entityId: { in: [lead.id, opp.id, proposal.id, cal.id] },
    },
  });
  if (audits < 3) throw new Error("Expected audit log entries for Golden Path entities");

  console.log("\nGOLDEN PATH WORKFLOW PASSED");
  console.log({
    leadId: lead.id,
    opportunityId: opp.id,
    proposalId: proposal.id,
    calendarEventId: cal.id,
    assignedAgentId: assignment.assignment.agentId,
    wonRevenueBefore: dashboardBefore.metrics.wonRevenue,
    wonRevenueAfter: dashboardAfter.metrics.wonRevenue,
    auditHits: audits,
  });
}

main()
  .catch((e) => {
    console.error("\nGOLDEN PATH FAILED", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
