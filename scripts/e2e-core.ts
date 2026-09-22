/**
 * Phase 0 core E2E workflow against local demo API.
 * Run: npx tsx scripts/e2e-core.ts
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
  let jar = cookies;
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

async function api(
  cookieHeader: string,
  method: string,
  path: string,
  body?: unknown,
) {
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
  console.log("E2E: login…");
  const { cookieHeader, user } = await login();
  console.log("  user", user.email, user.workspaceId);

  const stages = await api(cookieHeader, "GET", "/api/pipeline/stages");
  const stageBySlug = Object.fromEntries(
    (stages.items as Array<{ id: string; slug: string; name: string }>).map((s) => [s.slug, s]),
  );

  const property = await prisma.property.findFirst({
    where: { workspaceId: user.workspaceId, deletedAt: null, status: "AVAILABLE" },
  });
  if (!property) throw new Error("No property in seed");

  console.log("E2E: create lead…");
  const lead = await api(cookieHeader, "POST", "/api/leads", {
    firstName: "E2E",
    lastName: "Buyer",
    whatsappNumber: "+923001234567",
    phone: "+923001234567",
    source: "WHATSAPP_INBOUND",
    intentType: "BUY",
    preferredArea: "DHA Phase 6",
    propertyTypePref: "HOUSE",
    propertyPurpose: "SALE",
    bedroomPref: 5,
    budgetMin: 50000000,
    budgetMax: 100000000,
    ownerId: user.id,
    estimatedValue: 85000000,
  });
  console.log("  lead", lead.id);

  console.log("E2E: create opportunity…");
  const opp = await api(cookieHeader, "POST", "/api/opportunities", {
    name: "E2E Buyer — DHA Phase 6",
    dealSide: "BUYER",
    value: 85000000,
    currency: "PKR",
    stageId: stageBySlug.new.id,
    leadId: lead.id,
    linkedPropertyId: property.id,
    ownerId: user.id,
  });
  console.log("  opportunity", opp.id);

  console.log("E2E: move to Qualified…");
  await api(cookieHeader, "PATCH", `/api/opportunities/${opp.id}`, {
    stageId: stageBySlug.qualified.id,
  });

  console.log("E2E: assign lead to least-loaded agent…");
  const assignment = await api(cookieHeader, "POST", `/api/leads/${lead.id}/assign`);
  if (!assignment.assignment?.agentId) throw new Error("Assignment did not return an agentId");
  if (assignment.lead.ownerId !== assignment.assignment.agentId) {
    throw new Error("Lead ownerId not updated to assigned agent");
  }

  console.log("E2E: analyze + match + score + draft…");
  const analysis = await api(cookieHeader, "POST", "/api/intelligence", {
    kind: "LEAD_ANALYSIS",
    leadId: lead.id,
  });
  if (!analysis.output?.recommendedAction) throw new Error("Lead analysis missing recommendedAction");

  const matches = await api(cookieHeader, "POST", "/api/intelligence", {
    kind: "PROPERTY_MATCH",
    leadId: lead.id,
  });
  if (!Array.isArray(matches.scored)) throw new Error("Property match missing scored results");

  const scored = await api(cookieHeader, "POST", "/api/scoring", { leadId: lead.id });
  if (typeof scored.lead?.leadScore !== "number") throw new Error("Scoring did not return leadScore");

  const draft = await api(cookieHeader, "POST", "/api/intelligence", {
    kind: "FOLLOW_UP_DRAFT",
    leadId: lead.id,
  });
  if (!draft.output?.body || draft.output?.requiresApproval !== true) {
    throw new Error("WhatsApp draft missing or auto-approved");
  }

  console.log("E2E: log WhatsApp…");
  const wa = await api(cookieHeader, "POST", "/api/whatsapp/messages", {
    conversationId: `lead:${lead.id}`,
    body: "Assalam o Alaikum — confirming site visit interest.",
    leadId: lead.id,
    opportunityId: opp.id,
  });
  if (!wa.demo) throw new Error("Expected demo WhatsApp response");
  console.log(" ", wa.notice);

  console.log("E2E: schedule site visit…");
  const start = new Date(Date.now() + 36 * 3600000);
  const end = new Date(start.getTime() + 2 * 3600000);
  const cal = await api(cookieHeader, "POST", "/api/calendar", {
    title: "E2E Site Visit — DHA Phase 6",
    type: "SITE_VISIT",
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    location: "DHA Phase 6, Lahore",
    leadId: lead.id,
    opportunityId: opp.id,
  });
  if (!cal.demo) throw new Error("Expected demo calendar response");
  console.log(" ", cal.message);

  const events = await api(cookieHeader, "GET", "/api/calendar");
  if (!events.items.some((e: { id: string }) => e.id === cal.id)) {
    throw new Error("Site visit missing from calendar list");
  }

  console.log("E2E: move to Proposal…");
  await api(cookieHeader, "PATCH", `/api/opportunities/${opp.id}`, {
    stageId: stageBySlug.proposal.id,
  });

  console.log("E2E: create proposal…");
  const proposal = await api(cookieHeader, "POST", "/api/proposals", {
    opportunityId: opp.id,
    leadId: lead.id,
    linkedPropertyId: property.id,
    value: 85000000,
    status: "DRAFT",
  });
  console.log("  proposal", proposal.proposalNumber);

  console.log("E2E: mark SENT (creates follow-up task)…");
  await api(cookieHeader, "PATCH", `/api/proposals/${proposal.id}`, { status: "SENT" });
  const tasksAfterSend = await prisma.task.count({
    where: { workspaceId: user.workspaceId, proposalId: proposal.id, deletedAt: null },
  });
  if (tasksAfterSend < 1) throw new Error("Follow-up task not created after SENT");

  console.log("E2E: mark VIEWED…");
  const viewed = await api(cookieHeader, "PATCH", `/api/proposals/${proposal.id}`, {
    status: "VIEWED",
  });
  if (viewed.viewCount < 1) throw new Error("viewCount not incremented");

  const notifications = await api(cookieHeader, "GET", "/api/notifications");
  if (!Array.isArray(notifications.items)) throw new Error("Notifications payload missing");

  const executions = await api(cookieHeader, "GET", "/api/automations/executions");
  if (!Array.isArray(executions.items) || executions.items.length < 1) {
    throw new Error("Expected automation executions after stage/proposal events");
  }

  console.log("E2E: simulate proposal acceptance…");
  const accepted = await api(cookieHeader, "PATCH", `/api/proposals/${proposal.id}`, {
    status: "ACCEPTED",
  });
  if (accepted.status !== "ACCEPTED") throw new Error("Proposal did not move to ACCEPTED");

  const dashboardBefore = await api(cookieHeader, "GET", "/api/dashboard");

  console.log("E2E: move to Won…");
  await api(cookieHeader, "PATCH", `/api/opportunities/${opp.id}`, {
    stageId: stageBySlug.won.id,
  });

  const wonOpp = await prisma.opportunity.findUnique({
    where: { id: opp.id },
    include: { stage: true },
  });
  if (!wonOpp?.stage.isWon) throw new Error("Opportunity not in Won stage");

  const dashboardAfter = await api(cookieHeader, "GET", "/api/dashboard");
  if (!(dashboardAfter.metrics.wonRevenue > dashboardBefore.metrics.wonRevenue)) {
    throw new Error("Dashboard wonRevenue did not increase after opportunity moved to Won");
  }

  const audits = await prisma.auditLog.count({
    where: {
      workspaceId: user.workspaceId,
      entityId: { in: [lead.id, opp.id, proposal.id, cal.id, wa.message.id] },
    },
  });
  if (audits < 3) throw new Error("Expected audit log entries for E2E entities");

  const activities = await prisma.activity.count({
    where: { workspaceId: user.workspaceId, opportunityId: opp.id },
  });
  if (activities < 2) throw new Error("Expected timeline activities for opportunity");

  console.log("\nE2E CORE WORKFLOW PASSED");
  console.log({
    leadId: lead.id,
    opportunityId: opp.id,
    proposalId: proposal.id,
    calendarEventId: cal.id,
    assignedAgentId: assignment.assignment.agentId,
    wonRevenueBefore: dashboardBefore.metrics.wonRevenue,
    wonRevenueAfter: dashboardAfter.metrics.wonRevenue,
    auditHits: audits,
    activityHits: activities,
    followUpTasks: tasksAfterSend,
    analysisAction: analysis.output.recommendedAction,
    matchCount: matches.scored.length,
    leadScore: scored.lead.leadScore,
    automationHits: executions.items.length,
    notificationHits: notifications.items.length,
  });
}

main()
  .catch((e) => {
    console.error("\nE2E FAILED", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
