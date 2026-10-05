import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { createElement } from "react";
import { mockNextNavigation, render, renderAs, unlabelledControls, ALL_ROLES } from "../helpers/ui";

/**
 * Batch 3 #4: dashboard states must be honest. Empty workspaces show explicit empty states, a card labelled
 * "This Month" must not silently show all-time data, and the headline numbers say which metric they are.
 * Also covers the Settings screen (team form) for accessible names.
 */
const INTEGRATIONS_DEMO = {
  calendar: "demo",
  calendarDemo: true,
  whatsapp: "demo",
  whatsappDemo: true,
  whatsappMode: "demo" as const,
  whatsappDetail: "Demo provider. Messages are recorded in the CRM only; nothing is sent to WhatsApp.",
};

type DashboardViewProps = Parameters<typeof import("../../src/components/dashboard/dashboard-view").DashboardView>[0];

const emptyProps = (over: Partial<DashboardViewProps> = {}): DashboardViewProps => ({
  greeting: "Good morning",
  dateLabel: "Monday",
  firstName: "Sana",
  pipelineValue: 0,
  weighted: 0,
  pipelineDelta: null,
  weightedDelta: null,
  openCount: 0,
  newThisWeek: 0,
  visitsThisWeek: 0,
  visitsTomorrow: 0,
  proposalsCount: 0,
  proposalsViewed: 0,
  wonThisMonth: 0,
  wonDealsThisMonth: 0,
  trend: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"].map((month) => ({ month, pipeline: 0, weighted: 0 })),
  sources: [],
  leadTotal: 0,
  sourcesScope: "month",
  actions: [],
  recentLeads: [],
  recentOpps: [],
  properties: [],
  visits: [],
  ...over,
});

describe("dashboard states", () => {
  let DashboardView: typeof import("../../src/components/dashboard/dashboard-view").DashboardView;

  before(async () => {
    mockNextNavigation();
    ({ DashboardView } = await import("../../src/components/dashboard/dashboard-view"));
  });

  it("a brand-new workspace shows explicit empty states and no NaN/undefined/Infinity anywhere", () => {
    const html = render(createElement(DashboardView, emptyProps()));
    assert.match(html, /No leads yet/);
    assert.match(html, /No opportunities yet/);
    assert.match(html, /No opportunities were opened in the last 6 months/);
    assert.match(html, /No showings on the calendar/);
    assert.match(html, /Nothing is blocking the pipeline right now/);
    for (const bad of ["NaN", "undefined", "Infinity", "[object Object]"]) assert.ok(!html.includes(bad), `found ${bad}`);
  });

  it("the trend chart replaces itself with the empty message only when every month is zero", () => {
    const withData = render(
      createElement(DashboardView, emptyProps({ trend: [{ month: "Jan", pipeline: 5, weighted: 2 }, { month: "Feb", pipeline: 0, weighted: 0 }] })),
    );
    assert.ok(!withData.includes("No opportunities were opened in the last 6 months"));
  });

  it("'Leads by Source' says so when it falls back to all-time counts, and 'This Month' only when it is", () => {
    const sources = [{ name: "WhatsApp", value: 3, color: "#000" }];
    const month = render(createElement(DashboardView, emptyProps({ sources, leadTotal: 3, sourcesScope: "month" })));
    assert.match(month, />This Month</);
    assert.ok(!month.includes("All time (none this month)"));
    const all = render(createElement(DashboardView, emptyProps({ sources, leadTotal: 3, sourcesScope: "all" })));
    assert.match(all, /All time \(none this month\)/);
    assert.ok(!all.includes(">This Month<"));
  });

  it("the trend headline names its metric and the delta is described as deal value opened vs last month", () => {
    const none = render(createElement(DashboardView, emptyProps({ pipelineValue: 5_000_000 })));
    assert.match(none, /Open pipeline value/);
    assert.match(none, /no opportunities opened last month to compare/);
    const up = render(createElement(DashboardView, emptyProps({ pipelineValue: 5_000_000, pipelineDelta: 12.5 })));
    assert.match(up, /Deal value opened this month: \+12\.5% vs last month/);
    const down = render(createElement(DashboardView, emptyProps({ pipelineValue: 5_000_000, pipelineDelta: -40 })));
    assert.match(down, /-40\.0% vs last month/);
  });

  it("rows that exist are rendered instead of the empty message", () => {
    const html = render(
      createElement(
        DashboardView,
        emptyProps({
          recentLeads: [{ id: "l1", name: "Ali Raza", source: "WHATSAPP_INBOUND", requirement: "3 bed", score: 80, stage: "NEW", owner: "Sana", date: "Today" }],
          recentOpps: [{ id: "o1", name: "Deal A", value: 100, stage: "Qualified", days: 2 }],
        }),
      ),
    );
    assert.match(html, /Ali Raza/);
    assert.match(html, /Deal A/);
    assert.ok(!html.includes("No leads yet"));
    assert.ok(!html.includes("No opportunities yet"));
  });
});

describe("settings screen", () => {
  it("every form control has an accessible name for every role, and the section switcher is a labelled nav", async () => {
    mockNextNavigation();
    const { SettingsClient } = await import("../../src/app/(app)/settings/settings-client");
    for (const role of ALL_ROLES) {
      const html = renderAs(
        role,
        createElement(SettingsClient, {
          branding: null,
          workspaceName: "Acme",
          timezone: "America/Chicago",
          currency: "USD",
          isDemo: false,
          viewer: { userId: "u1", role, canEditWorkspace: role === "OWNER" || role === "ADMIN", canResetDemo: false, canManageMembers: role === "OWNER" || role === "ADMIN" },
          members: [],
          stages: [],
          integrations: INTEGRATIONS_DEMO,
        }),
      );
      assert.match(html, /<nav aria-label="Settings sections"/);
      assert.deepEqual(unlabelledControls(html), [], role);
    }
  });
});

describe("team section: invitation states", () => {
  const future = new Date(Date.now() + 2 * 86400000).toISOString();
  const past = new Date(Date.now() - 86400000).toISOString();
  const members = [
    { userId: "u-owner", name: "Olive Owner", email: "olive@example.test", role: "OWNER" as const, invitation: null },
    { userId: "u-active", name: "Active Agent", email: "active@example.test", role: "AGENT" as const, invitation: null },
    { userId: "u-pending", name: "Pending Person", email: "pending@example.test", role: "AGENT" as const, invitation: { state: "PENDING" as const, expiresAt: future } },
    { userId: "u-expired", name: "Expired Person", email: "expired@example.test", role: "VIEWER" as const, invitation: { state: "EXPIRED" as const, expiresAt: past } },
  ];

  async function team(role: "OWNER" | "ADMIN" | "MANAGER" | "AGENT" | "VIEWER") {
    mockNextNavigation();
    const { SettingsClient } = await import("../../src/app/(app)/settings/settings-client");
    return renderAs(
      role,
      createElement(SettingsClient, {
        branding: null,
        workspaceName: "Acme",
        timezone: "America/Chicago",
        currency: "USD",
        isDemo: false,
        viewer: { userId: "u-owner", role, canEditWorkspace: false, canResetDemo: false, canManageMembers: role === "OWNER" || role === "ADMIN" },
        members,
        stages: [],
        integrations: INTEGRATIONS_DEMO,
        initialTab: "team",
      }),
    );
  }

  it("an admin sees pending and expired badges and a 'New setup link' action for exactly those members", async () => {
    const html = await team("OWNER");
    assert.match(html, /Pending Person[\s\S]*Invitation pending, link valid until/);
    assert.match(html, /Expired Person[\s\S]*Invitation expired, create a new setup link/);
    assert.equal((html.match(/New setup link/g) ?? []).length, 2, "one per unfinished invitation, none for active members");
    assert.match(html, /Add a team member/);
    assert.deepEqual(unlabelledControls(html), []);
  });

  it("people who cannot manage members see the list but no invitation controls", async () => {
    for (const role of ["MANAGER", "AGENT", "VIEWER"] as const) {
      const html = await team(role);
      assert.match(html, /Active Agent/);
      assert.ok(!html.includes("New setup link"), role);
      assert.ok(!html.includes("Add a team member"), role);
      assert.ok(!html.includes("Remove"), role);
    }
  });
});

describe("integrations tab tells the truth (INTG-008, INTG-012)", () => {
  async function integrations(over: Partial<Omit<typeof INTEGRATIONS_DEMO, "whatsappMode">> & { whatsappMode?: "live" | "misconfigured" | "demo" | "disabled" }) {
    mockNextNavigation();
    const { SettingsClient } = await import("../../src/app/(app)/settings/settings-client");
    return renderAs(
      "OWNER",
      createElement(SettingsClient, {
        branding: null,
        workspaceName: "Acme",
        timezone: "America/Chicago",
        currency: "USD",
        isDemo: false,
        viewer: { userId: "u1", role: "OWNER", canEditWorkspace: true, canResetDemo: false, canManageMembers: true },
        members: [],
        stages: [],
        integrations: { ...INTEGRATIONS_DEMO, ...over },
        initialTab: "integrations",
      }),
    );
  }

  it("demo is labelled Demo and says nothing is sent", async () => {
    const html = await integrations({});
    assert.match(html, />Demo</);
    assert.match(html, /nothing is sent to WhatsApp/);
    assert.ok(!html.includes(">Live<"));
  });

  it("a live provider that is not fully configured is 'Not connected', never 'Live'", async () => {
    const html = await integrations({
      whatsapp: "whatsapp-business",
      whatsappDemo: false,
      whatsappMode: "misconfigured",
      whatsappDetail: "Live mode is selected but not configured (missing WHATSAPP_PHONE_NUMBER_ID). Messages are recorded as Failed until it is fixed.",
    });
    assert.match(html, />Not connected</);
    assert.match(html, /missing WHATSAPP_PHONE_NUMBER_ID/);
    assert.ok(!html.includes(">Live<"));
  });

  it("Live appears only for a configured live provider", async () => {
    const html = await integrations({ whatsapp: "whatsapp-business", whatsappDemo: false, whatsappMode: "live", whatsappDetail: "Live (Meta WhatsApp Business Cloud API)." });
    assert.match(html, />Live</);
  });

  it("the calendar is described as the internal CRM calendar, not a Google Calendar integration", async () => {
    const html = await integrations({});
    assert.match(html, /internal CRM calendar/);
    assert.match(html, /not synced with Google Calendar/);
  });
});

describe("automations page makes no claim it cannot keep (AUTO-001)", () => {
  it("says rules are fixed, and that auto-replies and the scheduled job are not controlled here", async () => {
    mockNextNavigation();
    const { default: AutomationsPage } = await import("../../src/app/(app)/automations/page");
    const html = render(createElement(AutomationsPage));
    assert.match(html, /cannot be created or edited here/);
    assert.match(html, /Automatic WhatsApp replies are not a rule/);
    assert.match(html, /only if the scheduled job has been set up/);
    assert.ok(!html.includes("AI never sends"), "the old absolute claim is gone");
  });
});
