import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { computeLeadScore } from "../../src/lib/scoring/score-lead";

/**
 * TEST-003: lead scoring. computeLeadScore is pure except for the clock (idle days, overdue follow-up), so the clock
 * is frozen. Expected numbers are worked out by hand from the weights in src/lib/scoring/score-lead.ts
 * (leadScore = fit 22% + intent 20% + value 18% + engagement 12% + best property match 10% + response 8% +
 * pipeline 6% + site visit 4%). They describe current behaviour, not product requirements.
 */
const NOW = new Date("2026-10-04T12:00:00Z");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

type Input = Parameters<typeof computeLeadScore>[0];
type LeadIn = Input["lead"];

const emptyLead: LeadIn = {
  stage: "NEW",
  intentType: "UNKNOWN",
  preferredArea: null,
  propertyTypePref: null,
  propertyPurpose: null,
  budgetMin: null,
  budgetMax: null,
  estimatedValue: null,
  timeline: null,
  lastActivityAt: null,
  followUpDue: null,
  notes: null,
};

const input = (over: Partial<Omit<Input, "lead">> = {}, lead: Partial<LeadIn> = {}): Input => ({
  lead: { ...emptyLead, ...lead },
  whatsappCount: 0,
  inboundCount: 0,
  outboundCount: 0,
  activityCount: 0,
  hasSiteVisit: false,
  pipelineSlug: null,
  bestPropertyMatch: 0,
  ...over,
});

function freezeClock() {
  mock.timers.enable({ apis: ["Date"], now: NOW });
}
afterEach(() => mock.timers.reset());

describe("computeLeadScore: worked examples", () => {
  it("a lead with no data at all: floor values, score 19", () => {
    freezeClock();
    // fit 28, intent 20+8, value 20, engagement 18-12 (never active), response 15, pipeline 16, site visit 12
    const s = computeLeadScore(input());
    assert.deepEqual(
      { fit: s.fit, intent: s.intent, value: s.value, engagement: s.engagement, propertyFit: s.propertyFit, response: s.response, pipeline: s.pipeline, siteVisit: s.siteVisit },
      { fit: 28, intent: 28, value: 20, engagement: 6, propertyFit: 0, response: 15, pipeline: 16, siteVisit: 12 },
    );
    assert.equal(s.leadScore, 19); // 6.16 + 5.6 + 3.6 + 0.72 + 0 + 1.2 + 0.96 + 0.48 = 18.72
    assert.deepEqual(s.reasons, []);
  });

  it("a fully qualified, engaged, high-value lead in negotiation: score 79, reasons capped at four in a fixed order", () => {
    freezeClock();
    const s = computeLeadScore(
      input(
        { whatsappCount: 12, inboundCount: 6, outboundCount: 6, activityCount: 9, hasSiteVisit: true, pipelineSlug: "negotiation", bestPropertyMatch: 85 },
        {
          stage: "QUALIFIED",
          intentType: "BUY",
          preferredArea: "Lincoln Park",
          propertyTypePref: "SINGLE_FAMILY",
          propertyPurpose: "SALE",
          estimatedValue: 90_000_000,
          timeline: "immediate",
          notes: "Wants to close quickly after the visit",
          lastActivityAt: ago(1),
        },
      ),
    );
    assert.deepEqual(
      { fit: s.fit, intent: s.intent, value: s.value, engagement: s.engagement, propertyFit: s.propertyFit, response: s.response, pipeline: s.pipeline, siteVisit: s.siteVisit },
      { fit: 94, intent: 70, value: 92, engagement: 62, propertyFit: 85, response: 45, pipeline: 82, siteVisit: 88 },
    );
    assert.equal(s.leadScore, 79); // 20.68 + 14 + 16.56 + 7.44 + 8.5 + 3.6 + 4.92 + 3.52 = 79.22
    assert.deepEqual(s.reasons, [
      "Preferred area is on file.",
      "Strong inventory match against available listings.",
      "Lead is qualified.",
      "High estimated deal value.",
    ]);
  });
});

describe("computeLeadScore: stage and intent", () => {
  const intentFor = (stage: string) => computeLeadScore(input({}, { stage })).intent;
  it("each stage adds its own weight on top of 20; lost and archived subtract", () => {
    freezeClock();
    assert.equal(intentFor("NEW"), 28);
    assert.equal(intentFor("CONTACTED"), 36);
    assert.equal(intentFor("QUALIFIED"), 48);
    assert.equal(intentFor("NURTURING"), 38);
    assert.equal(intentFor("CONVERTED"), 56);
    assert.equal(intentFor("LOST"), 10);
    assert.equal(intentFor("ARCHIVED"), 10);
    assert.equal(intentFor("SOMETHING_NEW"), 28, "an unknown stage is treated like NEW, not an error");
  });

  it("a timeline adds 16 when it names an urgent window and 8 otherwise; notes count only above 20 characters", () => {
    freezeClock();
    assert.equal(computeLeadScore(input({}, { timeline: "immediate" })).intent, 28 + 16);
    assert.equal(computeLeadScore(input({}, { timeline: "30 days" })).intent, 28 + 16);
    assert.equal(computeLeadScore(input({}, { timeline: "next year" })).intent, 28 + 8);
    assert.equal(computeLeadScore(input({}, { notes: "x".repeat(20) })).intent, 28, "20 characters is not enough");
    assert.equal(computeLeadScore(input({}, { notes: "x".repeat(21) })).intent, 28 + 6);
  });
});

describe("computeLeadScore: value thresholds", () => {
  const valueFor = (lead: Partial<LeadIn>) => computeLeadScore(input({}, lead)).value;
  it("steps at 80M, 40M and 15M, with any positive value above the floor", () => {
    freezeClock();
    assert.equal(valueFor({ estimatedValue: 80_000_000 }), 92);
    assert.equal(valueFor({ estimatedValue: 79_999_999 }), 78);
    assert.equal(valueFor({ estimatedValue: 40_000_000 }), 78);
    assert.equal(valueFor({ estimatedValue: 39_999_999 }), 62);
    assert.equal(valueFor({ estimatedValue: 15_000_000 }), 62);
    assert.equal(valueFor({ estimatedValue: 14_999_999 }), 48);
    assert.equal(valueFor({ estimatedValue: 1 }), 48);
    assert.equal(valueFor({}), 20);
  });

  it("falls back to the maximum budget when there is no estimated value; accepts Decimal-like and ignores junk", () => {
    freezeClock();
    assert.equal(valueFor({ budgetMax: 45_000_000 }), 78);
    assert.equal(valueFor({ estimatedValue: { toString: () => "90000000" } }), 92);
    assert.equal(valueFor({ estimatedValue: { toString: () => "not a number" }, budgetMax: 45_000_000 }), 78);
  });
});

describe("computeLeadScore: engagement, response, pipeline", () => {
  const engagement = (activityCount: number, idleDays: number | null) =>
    computeLeadScore(input({ activityCount }, { lastActivityAt: idleDays == null ? null : ago(idleDays) })).engagement;

  it("activity volume: 0 -> +0, 1 -> +6, 3 -> +14, 8 -> +24", () => {
    freezeClock();
    assert.deepEqual([0, 1, 2, 3, 7, 8, 50].map((n) => engagement(n, 0) - 38), [0, 6, 6, 14, 14, 24, 24]);
  });

  it("recency: <=2 days +20, <=7 +10, 8-21 +0, over 21 -12, never -12", () => {
    freezeClock();
    const base = 18;
    assert.equal(engagement(0, 0), base + 20);
    assert.equal(engagement(0, 2), base + 20);
    assert.equal(engagement(0, 3), base + 10);
    assert.equal(engagement(0, 7), base + 10);
    assert.equal(engagement(0, 8), base);
    assert.equal(engagement(0, 21), base);
    assert.equal(engagement(0, 22), base - 12);
    assert.equal(engagement(0, null), base - 12);
  });

  it("a future last-activity date counts as 'just now', not a negative idle time", () => {
    freezeClock();
    assert.equal(computeLeadScore(input({}, { lastActivityAt: new Date(NOW.getTime() + 3 * DAY) })).engagement, 38);
  });

  it("response: two-way WhatsApp +30, one-way +12, an overdue follow-up -8", () => {
    freezeClock();
    const response = (over: Partial<Input>, lead: Partial<LeadIn> = {}) => computeLeadScore(input(over, lead)).response;
    assert.equal(response({ whatsappCount: 4, inboundCount: 2, outboundCount: 2 }), 45);
    assert.equal(response({ whatsappCount: 3, inboundCount: 0, outboundCount: 3 }), 27);
    assert.equal(response({ whatsappCount: 3, inboundCount: 3, outboundCount: 0 }), 27);
    assert.equal(response({}), 15);
    assert.equal(response({}, { followUpDue: ago(1) }), 7);
    assert.equal(response({}, { followUpDue: new Date(NOW.getTime() + DAY) }), 15, "a follow-up in the future is not overdue");
  });

  it("pipeline stage slug maps to its weight; an unknown or missing slug is the low default", () => {
    freezeClock();
    const pipeline = (slug: string | null) => computeLeadScore(input({ pipelineSlug: slug })).pipeline;
    assert.deepEqual(
      ["qualified", "discovery", "solution", "proposal", "negotiation", "won", "other", null].map(pipeline),
      [28, 40, 52, 68, 82, 100, 16, 16],
    );
  });

  it("a site visit is worth 88, none 12", () => {
    freezeClock();
    assert.equal(computeLeadScore(input({ hasSiteVisit: true })).siteVisit, 88);
    assert.equal(computeLeadScore(input()).siteVisit, 12);
  });
});

describe("computeLeadScore: properties of the whole function", () => {
  it("is deterministic and does not mutate its input", () => {
    freezeClock();
    const i = input({ activityCount: 4, bestPropertyMatch: 70 }, { stage: "CONTACTED", lastActivityAt: ago(3) });
    const snapshot = JSON.stringify(i);
    assert.deepEqual(computeLeadScore(i), computeLeadScore(i));
    assert.equal(JSON.stringify(i), snapshot);
  });

  it("every component and the total stay integers in 0..100 across many random inputs", () => {
    freezeClock();
    let seed = 12345; // fixed LCG, so a failure reproduces
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
    for (let n = 0; n < 2000; n++) {
      const s = computeLeadScore(
        input(
          {
            whatsappCount: Math.floor(rnd() * 30),
            inboundCount: Math.floor(rnd() * 15),
            outboundCount: Math.floor(rnd() * 15),
            activityCount: Math.floor(rnd() * 40),
            hasSiteVisit: rnd() > 0.5,
            pipelineSlug: pick([null, "qualified", "discovery", "solution", "proposal", "negotiation", "won", "x"]),
            bestPropertyMatch: Math.floor(rnd() * 140) - 20, // deliberately out of range
          },
          {
            stage: pick(["NEW", "CONTACTED", "QUALIFIED", "NURTURING", "CONVERTED", "LOST", "ARCHIVED"]),
            intentType: pick(["UNKNOWN", "BUY", "RENT"]),
            preferredArea: pick([null, "Lincoln Park"]),
            estimatedValue: pick([null, 0, 5_000_000, 50_000_000, 200_000_000]),
            timeline: pick([null, "immediate", "later"]),
            lastActivityAt: pick([null, ago(0), ago(5), ago(40)]),
            followUpDue: pick([null, ago(2), new Date(NOW.getTime() + DAY)]),
            notes: pick([null, "short", "a note that is clearly long enough"]),
          },
        ),
      );
      for (const [k, v] of Object.entries(s)) {
        if (k === "reasons") continue;
        assert.ok(Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100, `${k}=${v}`);
      }
      assert.ok(s.reasons.length <= 4);
    }
  });

  it("more evidence never lowers the score: a site visit, a better property match, or more activity", () => {
    freezeClock();
    const base = input({ activityCount: 1, bestPropertyMatch: 40 }, { lastActivityAt: ago(1) });
    const total = (o: Partial<Input>) => computeLeadScore({ ...base, ...o }).leadScore;
    assert.ok(total({ hasSiteVisit: true }) >= total({ hasSiteVisit: false }));
    assert.ok(total({ bestPropertyMatch: 90 }) >= total({ bestPropertyMatch: 40 }));
    assert.ok(total({ activityCount: 9 }) >= total({ activityCount: 1 }));
  });

  it("an out-of-range property match is clamped rather than distorting the breakdown", () => {
    freezeClock();
    assert.equal(computeLeadScore(input({ bestPropertyMatch: 250 })).propertyFit, 100);
    assert.equal(computeLeadScore(input({ bestPropertyMatch: -30 })).propertyFit, 0);
  });
});
