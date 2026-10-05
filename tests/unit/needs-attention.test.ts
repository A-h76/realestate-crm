import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAttentionItem,
  detectFlags,
  elapsedLabel,
  explainPriority,
  isStaleOpportunity,
  leadState,
  opportunityLacksNextAction,
  rankAttention,
  resolveNextAction,
  type AttentionLead,
  type LeadSignals,
} from "../../src/lib/attention/rules";
import { countDuplicateGroups } from "../../src/lib/attention/hygiene";

/**
 * Needs Attention rules are pure: the clock is the `now` argument, so nothing here depends on wall time.
 * NOW is 2026-10-05 15:00Z; the "today" window is a fixed UTC day for readability.
 */
const NOW = new Date("2026-10-05T15:00:00Z");
const TODAY = { start: new Date("2026-10-05T00:00:00Z"), end: new Date("2026-10-06T00:00:00Z") };
const MIN = 60_000;
const DAY = 86_400_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const lead = (over: Partial<AttentionLead> = {}): AttentionLead => ({
  id: "l1",
  name: "Sarah Johnson",
  stage: "CONTACTED",
  intentType: "BUY",
  preferredArea: "Austin",
  ownerId: "u1",
  ownerName: "Agent One",
  createdAt: ago(3 * DAY),
  lastActivityAt: ago(1 * DAY),
  followUpDue: null,
  nextAction: null,
  ...over,
});

const signals = (over: Partial<LeadSignals> = {}): LeadSignals => ({
  lastInbound: null,
  lastContactAt: ago(DAY),
  openTasks: [],
  upcomingEvents: [],
  missedCallAt: null,
  propertyMatchCount: 0,
  ...over,
});

describe("needs attention rules", () => {
  it("flags a lead whose newest inbound message has no response", () => {
    const s = signals({ lastInbound: { at: ago(6 * MIN), body: "Can we see the house Saturday?" }, lastContactAt: ago(2 * DAY) });
    assert.deepEqual(detectFlags(lead(), s, NOW, TODAY), ["RESPOND_NOW"]);
    const item = buildAttentionItem(lead(), s, NOW, TODAY)!;
    assert.equal(item.category, "RESPOND_NOW");
    assert.equal(item.since?.getTime(), ago(6 * MIN).getTime());
    assert.equal(item.action.href, "/conversations?lead=l1");
  });

  it("does not flag a reply once we responded after it", () => {
    const s = signals({ lastInbound: { at: ago(2 * DAY), body: "hi" }, lastContactAt: ago(DAY) });
    assert.equal(detectFlags(lead(), s, NOW, TODAY).includes("RESPOND_NOW"), false);
  });

  it("flags a NEW lead nobody has contacted, with the real elapsed time", () => {
    const l = lead({ stage: "NEW", createdAt: ago(8 * MIN), lastActivityAt: null });
    const s = signals({ lastContactAt: null });
    assert.deepEqual(detectFlags(l, s, NOW, TODAY), ["NEW_UNCONTACTED"]);
    assert.ok(explainPriority(l, s, NOW, TODAY).reasons.includes("New lead, not contacted for 8 minutes"));
  });

  it("flags a recorded missed call until we contact the lead afterwards", () => {
    const missed = signals({ missedCallAt: ago(14 * MIN), lastContactAt: ago(DAY) });
    assert.ok(detectFlags(lead(), missed, NOW, TODAY).includes("MISSED_CALL"));
    const handled = signals({ missedCallAt: ago(14 * MIN), lastContactAt: ago(MIN) });
    assert.equal(detectFlags(lead(), handled, NOW, TODAY).includes("MISSED_CALL"), false);
  });

  it("splits overdue from due-today follow-ups using the lead date and open tasks", () => {
    const overdue = lead({ followUpDue: new Date("2026-10-03T12:00:00Z") });
    assert.ok(detectFlags(overdue, signals(), NOW, TODAY).includes("OVERDUE_FOLLOW_UP"));
    const dueToday = signals({ openTasks: [{ id: "t", title: "Call", dueAt: new Date("2026-10-05T20:00:00Z"), ownerName: null }] });
    const flags = detectFlags(lead(), dueToday, NOW, TODAY);
    assert.ok(flags.includes("FOLLOW_UP_TODAY"));
    assert.equal(flags.includes("OVERDUE_FOLLOW_UP"), false);
  });

  it("flags unassigned leads", () => {
    assert.ok(detectFlags(lead({ ownerId: null, ownerName: null }), signals(), NOW, TODAY).includes("UNASSIGNED"));
  });

  it("flags stale active leads only when nothing is scheduled, and never nurture leads", () => {
    const stale = lead({ lastActivityAt: ago(21 * DAY) });
    assert.ok(detectFlags(stale, signals(), NOW, TODAY).includes("GOING_COLD"));
    const booked = signals({ upcomingEvents: [{ id: "e", title: "Showing", type: "SITE_VISIT", startAt: new Date(NOW.getTime() + DAY) }] });
    assert.equal(detectFlags(stale, booked, NOW, TODAY).includes("GOING_COLD"), false);
    assert.deepEqual(detectFlags(lead({ stage: "NURTURING", lastActivityAt: ago(60 * DAY) }), signals(), NOW, TODAY), []);
  });

  it("ignores closed leads entirely", () => {
    for (const stage of ["LOST", "CONVERTED", "ARCHIVED"]) {
      const s = signals({ lastInbound: { at: ago(MIN), body: "hello" }, lastContactAt: null });
      assert.deepEqual(detectFlags(lead({ stage, ownerId: null }), s, NOW, TODAY), []);
    }
  });

  it("ranks respond-now above follow-ups above cold, oldest wait first", () => {
    const a = buildAttentionItem(lead({ id: "a", name: "A", lastActivityAt: ago(30 * DAY) }), signals(), NOW, TODAY)!;
    const b = buildAttentionItem(lead({ id: "b", name: "B" }), signals({ lastInbound: { at: ago(5 * MIN), body: "x" }, lastContactAt: null }), NOW, TODAY)!;
    const c = buildAttentionItem(lead({ id: "c", name: "C" }), signals({ lastInbound: { at: ago(50 * MIN), body: "y" }, lastContactAt: null }), NOW, TODAY)!;
    assert.deepEqual(rankAttention([a, b, c]).map((i) => i.leadId), ["c", "b", "a"]);
  });
});

describe("next action", () => {
  it("prefers the lead's own next action, then the soonest task, then the next appointment, else null", () => {
    const withField = lead({ nextAction: "Send property options", followUpDue: new Date("2026-10-06T14:00:00Z") });
    assert.equal(resolveNextAction(withField, signals())?.label, "Send property options");

    const tasks = signals({
      openTasks: [
        { id: "2", title: "Later", dueAt: new Date("2026-10-09T00:00:00Z"), ownerName: "Pat" },
        { id: "1", title: "Sooner", dueAt: new Date("2026-10-06T00:00:00Z"), ownerName: null },
      ],
    });
    const fromTask = resolveNextAction(lead(), tasks)!;
    assert.equal(fromTask.label, "Sooner");
    assert.equal(fromTask.ownerName, "Agent One");

    const appt = signals({ upcomingEvents: [{ id: "e", title: "Showing at 12 Oak St", type: "SITE_VISIT", startAt: new Date("2026-10-07T16:00:00Z") }] });
    assert.equal(resolveNextAction(lead(), appt)?.source, "appointment");

    assert.equal(resolveNextAction(lead(), signals()), null, "no data means no next action, never a fabricated one");
  });

  it("an opportunity lacks a next action only when nothing is planned anywhere", () => {
    assert.equal(opportunityLacksNextAction({ openTaskCount: 0, upcomingEventCount: 0, leadHasNextAction: false }), true);
    assert.equal(opportunityLacksNextAction({ openTaskCount: 1, upcomingEventCount: 0, leadHasNextAction: false }), false);
    assert.equal(opportunityLacksNextAction({ openTaskCount: 0, upcomingEventCount: 1, leadHasNextAction: false }), false);
    assert.equal(opportunityLacksNextAction({ openTaskCount: 0, upcomingEventCount: 0, leadHasNextAction: true }), false);
  });
});

describe("priority explanation", () => {
  it("explains HIGH priority from stored facts", () => {
    const s = signals({
      lastInbound: { at: ago(10 * MIN), body: "Can we get a showing this weekend?" },
      lastContactAt: null,
      propertyMatchCount: 12,
    });
    const p = explainPriority(lead(), s, NOW, TODAY);
    assert.equal(p.level, "high");
    assert.deepEqual(p.reasons, [
      "Lead replied 10 minutes ago and has no response yet",
      "Showing requested",
      "12 matching properties available",
    ]);
  });

  it("explains LOWER priority for a lead gone quiet", () => {
    const l = lead({ lastActivityAt: ago(21 * DAY) });
    const p = explainPriority(l, signals(), NOW, TODAY);
    assert.equal(p.level, "lower");
    assert.ok(p.reasons.includes("No activity for 21 days"));
    assert.ok(p.reasons.includes("No upcoming appointment"));
  });

  it("does not claim a showing was requested when the message does not say so", () => {
    const s = signals({ lastInbound: { at: ago(MIN), body: "thanks!" }, lastContactAt: null });
    assert.equal(explainPriority(lead(), s, NOW, TODAY).reasons.includes("Showing requested"), false);
  });
});

describe("lead state", () => {
  it("maps existing stages and derived rules to client-facing states", () => {
    assert.equal(leadState(lead({ stage: "LOST" }), signals(), NOW, TODAY), "Lost");
    assert.equal(leadState(lead({ stage: "CONVERTED" }), signals(), NOW, TODAY), "Converted");
    assert.equal(leadState(lead({ stage: "NURTURING", lastActivityAt: ago(90 * DAY) }), signals(), NOW, TODAY), "Nurture");
    assert.equal(leadState(lead({ lastActivityAt: ago(45 * DAY) }), signals(), NOW, TODAY), "Cold");
    assert.equal(leadState(lead(), signals({ lastInbound: { at: ago(MIN), body: "hi" }, lastContactAt: null }), NOW, TODAY), "Needs Attention");
    assert.equal(leadState(lead(), signals(), NOW, TODAY), "Active");
  });
});

describe("data hygiene helpers", () => {
  it("elapsedLabel is a plain difference of timestamps", () => {
    assert.equal(elapsedLabel(ago(30_000), NOW), "under a minute");
    assert.equal(elapsedLabel(ago(MIN), NOW), "1 minute");
    assert.equal(elapsedLabel(ago(3 * 60 * MIN), NOW), "3 hours");
    assert.equal(elapsedLabel(ago(2 * DAY), NOW), "2 days");
  });

  it("stale opportunity needs 30 days with no stage change and no update", () => {
    assert.equal(isStaleOpportunity({ stageEnteredAt: ago(40 * DAY), updatedAt: ago(35 * DAY) }, NOW), true);
    assert.equal(isStaleOpportunity({ stageEnteredAt: ago(40 * DAY), updatedAt: ago(2 * DAY) }, NOW), false);
  });

  it("counts duplicate contacts by full phone number or email, never by name", () => {
    const groups = countDuplicateGroups([
      { id: "1", phone: "(415) 555-0123", email: null },
      { id: "2", phone: "+14155550123", email: "x@y.com" },
      { id: "3", phone: null, email: "X@Y.com" },
      { id: "4", phone: "555-0100", email: null }, // incomplete number: no identity
      { id: "5", phone: "555-0100", email: null },
    ]);
    assert.equal(groups, 2); // the phone group {1,2} and the email group {2,3}
  });
});
