import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCrmEvents,
  dedupeLatestPerConversation,
  extractAuditFields,
  matchesInboxFilter,
  parseHandoffTask,
  summarizeRequirementFields,
  type ConversationListItem,
} from "../../src/lib/whatsapp/inbox-list";

describe("dedupeLatestPerConversation", () => {
  it("returns an empty map for an empty conversation window", () => {
    assert.equal(dedupeLatestPerConversation([]).size, 0);
  });

  it("keeps the first (most recent, given desc order) message per conversation across a long window", () => {
    const messages = [
      { conversationId: "lead:a", body: "a-latest" },
      { conversationId: "lead:b", body: "b-latest" },
      { conversationId: "lead:a", body: "a-older-1" },
      { conversationId: "lead:c", body: "c-latest" },
      { conversationId: "lead:a", body: "a-older-2" },
      { conversationId: "lead:b", body: "b-older" },
    ];
    const latest = dedupeLatestPerConversation(messages);
    assert.equal(latest.size, 3);
    assert.equal(latest.get("lead:a")?.body, "a-latest");
    assert.equal(latest.get("lead:b")?.body, "b-latest");
    assert.equal(latest.get("lead:c")?.body, "c-latest");
  });
});

describe("parseHandoffTask", () => {
  it("returns null for a missing task", () => {
    assert.equal(parseHandoffTask(null), null);
    assert.equal(parseHandoffTask(undefined), null);
  });

  it("returns null for a task with no description", () => {
    assert.equal(parseHandoffTask({ id: "t1", description: null, priority: "HIGH", status: "TODO" }), null);
  });

  it("returns null for a task description with no handoff tag (unrelated task)", () => {
    assert.equal(
      parseHandoffTask({ id: "t1", description: "Call the lead back tomorrow", priority: "MEDIUM", status: "TODO" }),
      null,
    );
  });

  it("parses the reason and suggested action out of a well-formed handoff summary", () => {
    const description = [
      "HUMAN HANDOFF REQUIRED",
      "",
      "Reason: Site visit requested",
      "Lead: Ahmed Khan (+923001234567)",
      "Requirement: 5 Marla, House, DHA Phase 2, Rent",
      "Matched Properties: 3",
      'Last Customer Message: "kal property dekh sakte hain?"',
      "Suggested Action: Schedule site visit",
      "Priority: HIGH",
      "",
      "[handoff:SITE_VISIT_REQUESTED]",
    ].join("\n");
    const parsed = parseHandoffTask({ id: "t1", description, priority: "HIGH", status: "TODO" });
    assert.ok(parsed);
    assert.equal(parsed?.taskId, "t1");
    assert.equal(parsed?.reasonCode, "SITE_VISIT_REQUESTED");
    assert.equal(parsed?.reasonLabel, "Site visit requested");
    assert.equal(parsed?.actionLabel, "Schedule site visit");
    assert.equal(parsed?.status, "TODO");
  });

  it("falls back to the known reason label when the description is missing the optional Reason/Suggested Action lines", () => {
    const parsed = parseHandoffTask({
      id: "t1",
      description: "Some note\n\n[handoff:HUMAN_REQUESTED]",
      priority: "HIGH",
      status: "TODO",
    });
    assert.ok(parsed);
    assert.equal(parsed?.reasonCode, "HUMAN_REQUESTED");
    assert.equal(parsed?.reasonLabel, "Customer requested a human agent");
    assert.equal(parsed?.actionLabel, null);
  });

  it("reports IN_PROGRESS once an agent has taken over, distinct from an unclaimed TODO handoff", () => {
    const description = "Reason: Site visit requested\nSuggested Action: Schedule site visit\n\n[handoff:SITE_VISIT_REQUESTED]";
    const claimed = parseHandoffTask({ id: "t1", description, priority: "HIGH", status: "IN_PROGRESS" });
    assert.equal(claimed?.status, "IN_PROGRESS");
    const unclaimed = parseHandoffTask({ id: "t1", description, priority: "HIGH", status: "TODO" });
    assert.equal(unclaimed?.status, "TODO");
  });
});

function conversation(overrides: Partial<ConversationListItem>): ConversationListItem {
  return {
    conversationId: "lead:x",
    lead: { id: "lead_x", name: "Test Lead", phone: null, stage: "NEW", ownerId: null, ownerName: null },
    lastMessage: null,
    handoff: null,
    needsReply: false,
    ...overrides,
  };
}

describe("matchesInboxFilter", () => {
  it("'all' always matches", () => {
    assert.equal(matchesInboxFilter(conversation({}), "all", null), true);
  });

  it("'needs_attention' matches an unanswered inbound message or an open handoff", () => {
    assert.equal(matchesInboxFilter(conversation({ needsReply: true }), "needs_attention", null), true);
    assert.equal(
      matchesInboxFilter(
        conversation({
          handoff: { taskId: "t1", reasonCode: "X", reasonLabel: "X", actionLabel: null, triggerMessage: null, priority: "HIGH", status: "TODO" },
        }),
        "needs_attention",
        null,
      ),
      true,
    );
    assert.equal(matchesInboxFilter(conversation({ needsReply: false, handoff: null }), "needs_attention", null), false);
  });

  it("'handoff' only matches an active handoff", () => {
    assert.equal(matchesInboxFilter(conversation({ needsReply: true, handoff: null }), "handoff", null), false);
  });

  it("'mine' matches only the current user's owned lead, and never matches with no current user", () => {
    const item = conversation({ lead: { id: "lead_x", name: "T", phone: null, stage: "NEW", ownerId: "user_1", ownerName: "Ali" } });
    assert.equal(matchesInboxFilter(item, "mine", "user_1"), true);
    assert.equal(matchesInboxFilter(item, "mine", "user_2"), false);
    assert.equal(matchesInboxFilter(item, "mine", null), false);
  });
});

describe("summarizeRequirementFields / extractAuditFields", () => {
  it("maps known field names to human labels and passes through unknown ones", () => {
    assert.equal(summarizeRequirementFields(["preferredArea", "budgetMax"]), "Area, Budget max");
    assert.equal(summarizeRequirementFields(["somethingUnmapped"]), "somethingUnmapped");
    assert.equal(summarizeRequirementFields([]), "");
  });

  it("defensively reads AuditLog.metadata.fields, never throwing on malformed shapes", () => {
    assert.deepEqual(extractAuditFields({ fields: ["preferredArea", 5, "budgetMax"] }), ["preferredArea", "budgetMax"]);
    assert.deepEqual(extractAuditFields({}), []);
    assert.deepEqual(extractAuditFields(null), []);
    assert.deepEqual(extractAuditFields("not an object"), []);
    assert.deepEqual(extractAuditFields({ fields: "not an array" }), []);
  });
});

describe("buildCrmEvents", () => {
  it("returns no events for an empty conversation", () => {
    assert.deepEqual(buildCrmEvents([], []), []);
  });

  it("excludes WHATSAPP_MESSAGE activities (they duplicate the real message bubbles)", () => {
    const events = buildCrmEvents(
      [{ id: "a1", type: "WHATSAPP_MESSAGE", title: "WhatsApp message logged", notes: "hi", date: new Date() }],
      [],
    );
    assert.equal(events.length, 0);
  });

  it("renders a handoff (SYSTEM) activity with missing notes gracefully", () => {
    const events = buildCrmEvents(
      [{ id: "a1", type: "SYSTEM", title: "Human handoff — Site visit requested", notes: null, date: new Date("2026-01-01T10:00:00Z") }],
      [],
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].title, "Human handoff — Site visit requested");
    assert.equal(events[0].detail, null);
  });

  it("summarizes a requirement-update audit row from its changed fields", () => {
    const events = buildCrmEvents(
      [],
      [{ id: "r1", createdAt: new Date("2026-01-01T09:00:00Z"), metadata: { fields: ["preferredArea", "propertyPurpose"], source: "whatsapp_extraction" } }],
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].title, "Requirement updated");
    assert.equal(events[0].detail, "Area, Purpose");
  });

  it("orders a long, interleaved conversation of activities and requirement updates chronologically", () => {
    const activities = Array.from({ length: 20 }, (_, i) => ({
      id: `a${i}`,
      type: "SITE_VISIT",
      title: `Event ${i}`,
      notes: null,
      date: new Date(2026, 0, 1, 0, 0, i * 2), // even seconds
    }));
    const requirementUpdates = Array.from({ length: 20 }, (_, i) => ({
      id: `r${i}`,
      createdAt: new Date(2026, 0, 1, 0, 0, i * 2 + 1), // odd seconds, interleaved
      metadata: { fields: ["budgetMax"] },
    }));
    const events = buildCrmEvents(activities, requirementUpdates);
    assert.equal(events.length, 40);
    for (let i = 1; i < events.length; i++) {
      assert.ok(new Date(events[i].at).getTime() >= new Date(events[i - 1].at).getTime());
    }
  });
});
