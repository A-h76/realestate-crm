import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import type { ReactElement } from "react";
import { createElement } from "react";
import type { WorkspaceRole } from "@prisma/client";
import { ALL_ROLES, MANAGER_ROLES, SALES_ROLES, mockNextNavigation, renderAs, unlabelledControls } from "../helpers/ui";

/**
 * Batch 3 #7: controls are offered only to roles the server would accept (the server stays authoritative; the HTTP
 * tests in tests/security prove the 403s). Expected visibility per role is written out by hand, not derived from
 * src/lib/authz.ts. Also checks every form control on these screens has an accessible name.
 */
type Case = {
  name: string;
  build: () => ReactElement;
  /** text that must appear exactly for these roles */
  shown: Array<{ text: string | RegExp; roles: WorkspaceRole[] }>;
};

let cases: Case[];

const has = (html: string, text: string | RegExp) => (typeof text === "string" ? html.includes(text) : text.test(html));

describe("role-aware controls", () => {
  before(async () => {
    mockNextNavigation();
    const { TakeOverButton } = await import("../../src/components/whatsapp/take-over-button");
    const { LeadStageControl } = await import("../../src/components/leads/lead-stage-control");
    const { LogActivityForm } = await import("../../src/components/leads/log-activity-form");
    const { LeadIntelligencePanel } = await import("../../src/components/intelligence/lead-intelligence");
    const { TasksClient } = await import("../../src/app/(app)/tasks/tasks-client");
    const { ProposalsClient } = await import("../../src/app/(app)/proposals/proposals-client");
    const { CalendarClient } = await import("../../src/app/(app)/calendar/calendar-client");
    const { PipelineBoard } = await import("../../src/app/(app)/pipeline/pipeline-board");
    const { LeadsTable } = await import("../../src/app/(app)/leads/leads-table");
    const { OpportunitiesClient } = await import("../../src/app/(app)/opportunities/opportunities-client");
    const { WhatsAppThread } = await import("../../src/components/whatsapp/whatsapp-thread");
    const { SourceDeclarations } = await import("../../src/components/settings/source-declarations");

    const analysis = {
      fitScore: 70,
      intentScore: 60,
      valueScore: 50,
      confidence: 80,
      niche: "Residential",
      likelyNeed: "3 bed house",
      painPoints: [],
      recommendedAction: "Call today",
      reasoning: "Budget matches",
    };
    const intel = (status: string) =>
      createElement(LeadIntelligencePanel, {
        leadId: "l1",
        conversationId: "lead:l1",
        fitScore: 1,
        intentScore: 1,
        valueScore: 1,
        leadScore: 1,
        analysis,
        analysisRun: { id: "r1", status, reviewedBy: status === "COMPLETED" ? null : "Sana", reviewedAt: null },
        matches: [],
        history: [],
      });
    const stages = [
      { id: "s1", name: "Qualified", probability: 20, accentColor: null, isWon: false, isLost: false },
      { id: "s2", name: "Won", probability: 100, accentColor: null, isWon: true, isLost: false },
    ];

    cases = [
      { name: "TakeOverButton", build: () => createElement(TakeOverButton, { leadId: "l1" }), shown: [{ text: "Take over", roles: SALES_ROLES }] },
      { name: "LogActivityForm", build: () => createElement(LogActivityForm, { leadId: "l1" }), shown: [{ text: "Log activity", roles: SALES_ROLES }] },
      {
        name: "LeadStageControl",
        build: () => createElement(LeadStageControl, { leadId: "l1", stage: "NEW" }),
        // the select is always shown (it displays the stage) but is disabled for read-only roles
        shown: [{ text: /<select[^>]*disabled/, roles: ["VIEWER"] }],
      },
      {
        name: "LeadIntelligencePanel (not yet reviewed)",
        build: () => intel("COMPLETED"),
        shown: [
          { text: "Review lead", roles: SALES_ROLES },
          { text: "Refresh score", roles: SALES_ROLES },
          { text: "Find property match", roles: SALES_ROLES },
          { text: "Schedule showing", roles: SALES_ROLES },
          { text: "Prepare for call", roles: SALES_ROLES },
          { text: "Approve", roles: MANAGER_ROLES },
          { text: "Reject", roles: MANAGER_ROLES },
          { text: "Review: Not yet reviewed", roles: ALL_ROLES },
          { text: "Suggested Reply", roles: SALES_ROLES },
        ],
      },
      {
        name: "LeadIntelligencePanel (approved)",
        build: () => intel("APPROVED"),
        shown: [
          { text: "Review: Approved by Sana", roles: ALL_ROLES },
          { text: "Reject", roles: MANAGER_ROLES },
        ],
      },
      {
        name: "TasksClient",
        build: () =>
          createElement(TasksClient, {
            initialTasks: [
              { id: "t1", title: "Call", description: null, status: "TODO", priority: "HIGH", dueAt: new Date().toISOString(), completedAt: null, ownerName: null, leadName: null, opportunityName: null },
            ],
          }),
        shown: [
          { text: />Complete</, roles: SALES_ROLES },
          { text: "Start", roles: SALES_ROLES },
        ],
      },
      {
        name: "SourceDeclarations",
        build: () => createElement(SourceDeclarations, { declared: ["ZILLOW"] }),
        shown: [
          { text: "Save lead sources", roles: ["OWNER", "ADMIN"] },
          { text: 'type="checkbox"', roles: ["OWNER", "ADMIN"] },
          { text: "Only the workspace owner or an admin can change this.", roles: ["MANAGER", "AGENT", "VIEWER"] },
        ],
      },
      {
        name: "ProposalsClient",
        build: () =>
          createElement(ProposalsClient, {
            initialProposals: [
              { id: "p1", proposalNumber: "P-1", status: "DRAFT", value: 100, viewCount: 0, sentAt: null, viewedAt: null, expiryAt: null, leadName: null, opportunityName: null, propertyTitle: null, ownerName: null },
            ],
            opportunities: [],
            properties: [],
            leads: [],
          }),
        shown: [
          { text: "New proposal", roles: SALES_ROLES },
          { text: "Mark sent", roles: SALES_ROLES },
          { text: "View only", roles: ["VIEWER"] },
        ],
      },
      {
        name: "CalendarClient",
        build: () => createElement(CalendarClient, { initialEvents: [], leads: [], opportunities: [] }),
        shown: [{ text: "Schedule showing", roles: SALES_ROLES }],
      },
      {
        name: "PipelineBoard",
        build: () =>
          createElement(PipelineBoard, {
            stages,
            initialOpportunities: [
              { id: "o1", name: "Deal A", stageId: "s1", dealSide: "BUYER", value: 1, probability: 20, ownerName: null, propertyTitle: null, leadName: null, leadScore: null, daysInStage: 1, nextAction: null },
            ],
          }),
        shown: [
          { text: "Move Deal A to stage", roles: SALES_ROLES },
          { text: "Your role is view-only", roles: ["VIEWER"] },
        ],
      },
      {
        name: "LeadsTable",
        build: () => createElement(LeadsTable, { initialLeads: [] }),
        shown: [
          { text: "New lead", roles: SALES_ROLES },
          { text: "Export CSV", roles: SALES_ROLES },
          { text: "Import CSV", roles: SALES_ROLES },
        ],
      },
      {
        name: "OpportunitiesClient",
        build: () => createElement(OpportunitiesClient, { initialOpportunities: [], stages: [], leads: [], properties: [] }),
        shown: [{ text: "New opportunity", roles: SALES_ROLES }],
      },
      {
        name: "WhatsAppThread",
        build: () => createElement(WhatsAppThread, { leadId: "l1", conversationId: "lead:l1" }),
        shown: [
          { text: "Your role is view-only", roles: ["VIEWER"] },
          { text: /Send (demo )?message/, roles: ALL_ROLES }, // present in markup for all, but hidden (class "hidden") for read-only
        ],
      },
    ];
  });

  it("each control is rendered for exactly the roles that may use it", () => {
    const problems: string[] = [];
    for (const c of cases) {
      for (const role of ALL_ROLES) {
        const html = renderAs(role, c.build());
        for (const { text, roles } of c.shown) {
          const expected = roles.includes(role);
          if (has(html, text) !== expected) {
            problems.push(`${c.name} / ${role}: "${String(text)}" ${expected ? "should be shown" : "should NOT be shown"}`);
          }
        }
      }
    }
    assert.deepEqual(problems, []);
  });

  it("a read-only member cannot reach the WhatsApp composer (hidden, with an explanation)", () => {
    const wa = cases.find((c) => c.name === "WhatsAppThread")!;
    const viewer = renderAs("VIEWER", wa.build());
    assert.match(viewer, /class="[^"]*\bhidden\b[^"]*"[^>]*>\s*<textarea/);
    const agent = renderAs("AGENT", wa.build());
    assert.ok(!/class="[^"]*\bhidden\b[^"]*"[^>]*>\s*<textarea/.test(agent));
  });

  it("take-over of a lead someone else owns is offered only to roles that may reassign (INTG-007)", async () => {
    const { TakeOverButton } = await import("../../src/components/whatsapp/take-over-button");
    for (const role of ALL_ROLES) {
      const html = renderAs(role, createElement(TakeOverButton, { leadId: "l1", ownedByOther: true }));
      assert.equal(html.includes("Take over"), MANAGER_ROLES.includes(role), role);
    }
  });

  it("the thread shows neither Demo nor Live until the server has said which provider is active", () => {
    const wa = cases.find((c) => c.name === "WhatsAppThread")!;
    const html = renderAs("OWNER", wa.build());
    assert.ok(!html.includes(">Demo<") && !html.includes(">Live<") && !html.includes("Not connected"));
  });

  it("nothing is offered outside a provider (fails closed)", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { TakeOverButton } = await import("../../src/components/whatsapp/take-over-button");
    const { LogActivityForm } = await import("../../src/components/leads/log-activity-form");
    assert.equal(renderToStaticMarkup(createElement(TakeOverButton, { leadId: "l1" })), "");
    assert.equal(renderToStaticMarkup(createElement(LogActivityForm, { leadId: "l1" })), "");
  });

  it("every form control on these screens has an accessible name, for every role", () => {
    const problems: string[] = [];
    for (const c of cases) {
      for (const role of ALL_ROLES) {
        for (const offender of unlabelledControls(renderAs(role, c.build()))) problems.push(`${c.name} / ${role}: ${offender}`);
      }
    }
    assert.deepEqual([...new Set(problems)], []);
  });
});
