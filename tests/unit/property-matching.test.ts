import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Lead, Property } from "@prisma/client";
import { filterAndScoreProperties, scorePropertyMatch } from "../../src/lib/matching/properties";

/**
 * TEST-003: property matching. Expected scores are worked out by hand from the weights in
 * src/lib/matching/properties.ts (type 16, purpose 12, area 18 / same-city 13, budget up to 16, bedrooms 6/3,
 * bathrooms 5/3, size 8/3, furnished 3, available 5, timeline 5; no-preference baselines type 8, purpose 6).
 * They describe what the code does today; they are not a statement of product requirements.
 */
const WS = "ws-a";

const lead = (over: Partial<Record<keyof Lead, unknown>> = {}): Lead =>
  ({
    workspaceId: WS,
    propertyTypePref: "SINGLE_FAMILY",
    propertyPurpose: "SALE",
    preferredArea: "Lincoln Park",
    budgetMin: 1_600_000,
    budgetMax: 2_000_000,
    bedroomPref: 4,
    bathroomPref: null,
    sizePrefMin: null,
    sizePrefMax: null,
    sizeUnitPref: null,
    furnishedPref: null,
    timeline: null,
    ...over,
  }) as unknown as Lead;

let seq = 0;
const property = (over: Partial<Record<keyof Property, unknown>> = {}): Property =>
  ({
    id: `p${++seq}`,
    workspaceId: WS,
    propertyType: "SINGLE_FAMILY",
    purpose: "SALE",
    area: "Lincoln Park",
    city: "Chicago",
    state: "IL",
    postalCode: "60614",
    price: 1_800_000,
    bedrooms: 4,
    bathrooms: null,
    size: null,
    sizeUnit: null,
    furnishedStatus: null,
    status: "AVAILABLE",
    deletedAt: null,
    ...over,
  }) as unknown as Property;

const score = (l: Lead, p: Property) => scorePropertyMatch(l, p);

describe("scorePropertyMatch: worked examples", () => {
  it("a listing matching every stated preference scores 73 with its reasons in display order and no caution", () => {
    // type 16 + purpose 12 + area 18 + budget 16 + bedrooms 6 + available 5
    const m = score(lead(), property());
    assert.equal(m.matchScore, 73);
    assert.deepEqual(m.reasons.map((r) => r.factor), ["Area", "Budget", "Bedrooms", "Availability", "Type", "Purpose"]);
    assert.equal(m.caution, null);
  });

  it("a lead who named the city gets 13 for any listing in it, not the full 18", () => {
    // Asked for "Chicago"; the listing is in a Chicago neighborhood but not a neighborhood match.
    const m = score(lead({ preferredArea: "Chicago" }), property({ area: "Logan Square" }));
    assert.equal(m.matchScore, 68); // 73 - 18 + 13
    assert.ok(m.reasons.some((r) => r.factor === "Area" && r.detail.includes("same city")));
  });

  it("an unrelated area in another city earns nothing for area and is not listed as a reason", () => {
    const m = score(lead(), property({ area: "Brookdale", city: "Naperville", postalCode: "60540" }));
    assert.equal(m.matchScore, 55); // 73 - 18
    assert.ok(!m.reasons.some((r) => r.factor === "Area"));
  });

  it("area comparison is case-insensitive and tolerates a substring either way", () => {
    assert.equal(score(lead({ preferredArea: "lincoln" }), property({ area: "Lincoln Park" })).matchScore, 73);
    assert.equal(score(lead({ preferredArea: "  LINCOLN PARK  " }), property()).matchScore, 73);
  });
});

describe("scorePropertyMatch: budget boundaries", () => {
  it("both ends of the stated range count as inside it", () => {
    assert.equal(score(lead(), property({ price: 1_600_000 })).matchScore, 73);
    assert.equal(score(lead(), property({ price: 2_000_000 })).matchScore, 73);
  });

  it("just over the maximum loses points in proportion to the overshoot (span 400k, 25% over -> 6 of 16)", () => {
    const m = score(lead(), property({ price: 2_100_000 }));
    assert.equal(m.matchScore, 63);
    assert.equal(m.caution, null, "exactly 10% over the maximum is not yet 'above the band'");
  });

  it("far above the maximum earns 0 budget points and carries a caution", () => {
    const m = score(lead(), property({ price: 2_400_000 }));
    assert.equal(m.matchScore, 57);
    assert.equal(m.caution, "Price is above the stated budget band");
  });

  it("below the minimum is penalised the same way", () => {
    assert.equal(score(lead(), property({ price: 1_500_000 })).matchScore, 73 - 16 + 6);
    assert.equal(score(lead(), property({ price: 900_000 })).matchScore, 73 - 16);
  });

  it("no budget on the lead, or no price on the listing, skips the budget factor instead of failing", () => {
    assert.equal(score(lead({ budgetMin: null, budgetMax: null }), property()).matchScore, 73 - 16);
    assert.equal(score(lead({ budgetMin: 1_600_000, budgetMax: null }), property()).matchScore, 73 - 16, "needs both ends");
    assert.equal(score(lead(), property({ price: 0 })).matchScore, 73 - 16);
    assert.equal(score(lead(), property({ price: null })).matchScore, 73 - 16);
  });

  it("accepts Decimal-like values and ignores non-numeric ones", () => {
    const decimal = (v: string) => ({ toString: () => v });
    assert.equal(score(lead({ budgetMin: decimal("1600000"), budgetMax: decimal("2000000") }), property({ price: decimal("1800000") })).matchScore, 73);
    assert.equal(score(lead({ budgetMin: decimal("abc") }), property()).matchScore, 73 - 16);
  });
});

describe("scorePropertyMatch: other factors", () => {
  it("bedrooms: exact 6, off by one 3, off by two 0, listing without bedrooms skipped", () => {
    assert.equal(score(lead(), property({ bedrooms: 3 })).matchScore, 70);
    assert.equal(score(lead(), property({ bedrooms: 5 })).matchScore, 70);
    assert.equal(score(lead(), property({ bedrooms: 2 })).matchScore, 67);
    assert.equal(score(lead(), property({ bedrooms: null })).matchScore, 67);
  });

  it("bathrooms: exact 5, off by one 3, otherwise 0", () => {
    const l = lead({ bathroomPref: 3 });
    assert.equal(score(l, property({ bathrooms: 3 })).matchScore, 78);
    assert.equal(score(l, property({ bathrooms: 4 })).matchScore, 76);
    assert.equal(score(l, property({ bathrooms: 6 })).matchScore, 73);
  });

  it("size counts only in the same unit: inside the range 8, outside 3, different unit 0", () => {
    const l = lead({ sizeUnitPref: "SQFT", sizePrefMin: 2_000, sizePrefMax: 3_000 });
    assert.equal(score(l, property({ size: 2_500, sizeUnit: "SQFT" })).matchScore, 81);
    assert.equal(score(l, property({ size: 3_600, sizeUnit: "SQFT" })).matchScore, 76);
    assert.equal(score(l, property({ size: 2_500, sizeUnit: "ACRE" })).matchScore, 73, "acres are not square feet");
    assert.equal(score(l, property({ size: 2_000, sizeUnit: "SQFT" })).matchScore, 81, "range ends are inclusive");
    assert.equal(score(l, property({ size: 3_000, sizeUnit: "SQFT" })).matchScore, 81);
  });

  it("furnished matches case-insensitively for 3 points", () => {
    assert.equal(score(lead({ furnishedPref: "Furnished" }), property({ furnishedStatus: "furnished" })).matchScore, 76);
    assert.equal(score(lead({ furnishedPref: "Furnished" }), property({ furnishedStatus: "Unfurnished" })).matchScore, 73);
  });

  it("an urgent timeline adds 5 only for an available listing", () => {
    assert.equal(score(lead({ timeline: "immediate" }), property()).matchScore, 78);
    assert.equal(score(lead({ timeline: "in 2 years" }), property()).matchScore, 73);
    const reserved = score(lead({ timeline: "immediate" }), property({ status: "RESERVED" }));
    assert.equal(reserved.matchScore, 68, "no availability or timeline bonus: 73 - 5 - 0");
  });

  it("a lead with no stated type or purpose gets the smaller baseline points", () => {
    const l = lead({ propertyTypePref: null, propertyPurpose: null, preferredArea: null, budgetMin: null, budgetMax: null, bedroomPref: null });
    assert.equal(score(l, property()).matchScore, 8 + 6 + 5);
  });

  it("a reserved listing is scored but carries a caution; an over-budget caution replaces it", () => {
    const reserved = score(lead(), property({ status: "RESERVED" }));
    assert.equal(reserved.caution, "Listing is reserved");
    assert.equal(score(lead(), property({ status: "RESERVED", price: 60_000_000 })).caution, "Price is above the stated budget band");
  });

  it("the score never leaves 0..100, even with every factor on", () => {
    const l = lead({ bathroomPref: 3, sizeUnitPref: "SQFT", sizePrefMin: 2_000, sizePrefMax: 3_000, furnishedPref: "Furnished", timeline: "immediate" });
    const m = score(l, property({ bathrooms: 3, size: 2_500, sizeUnit: "SQFT", furnishedStatus: "Furnished" }));
    assert.ok(m.matchScore <= 100 && m.matchScore >= 0);
    assert.equal(m.matchScore, 73 + 5 + 8 + 3 + 5);
    assert.ok(m.reasons.length <= 6);
  });
});

describe("filterAndScoreProperties", () => {
  it("drops listings of the wrong type or purpose, and withdrawn / sold / rented / deleted ones", () => {
    const keep = property({ id: "keep" });
    const rows = [
      keep,
      property({ id: "wrong-type", propertyType: "CONDO" }),
      property({ id: "wrong-purpose", purpose: "RENT" }),
      property({ id: "withdrawn", status: "WITHDRAWN" }),
      property({ id: "sold", status: "SOLD" }),
      property({ id: "rented", status: "RENTED" }),
      property({ id: "deleted", deletedAt: new Date() }),
    ];
    assert.deepEqual(filterAndScoreProperties(lead(), rows).map((m) => m.property.id), ["keep"]);
  });

  it("keeps a reserved listing (it can still be shown, with a caution)", () => {
    const [m] = filterAndScoreProperties(lead(), [property({ id: "r", status: "RESERVED" })]);
    assert.equal(m.property.id, "r");
    assert.equal(m.caution, "Listing is reserved");
  });

  it("never returns a listing from another workspace (defence in depth)", () => {
    const rows = [property({ id: "mine" }), property({ id: "theirs", workspaceId: "ws-b" })];
    assert.deepEqual(filterAndScoreProperties(lead(), rows).map((m) => m.property.id), ["mine"]);
  });

  it("applies the 35-point floor: 32 is out, 35 is in", () => {
    // lead wants only an area; baselines type 8 + purpose 6 + available 5 = 19, plus area 18 = 37 -> in. Take area away -> 19 -> out.
    const l = lead({ propertyTypePref: null, propertyPurpose: null, budgetMin: null, budgetMax: null, bedroomPref: null });
    assert.equal(filterAndScoreProperties(l, [property()]).length, 1);
    assert.equal(filterAndScoreProperties(l, [property({ area: "Brookdale", city: "Naperville" })]).length, 0);
    // Exact boundary via the same-city partial credit: baselines 19 + same-city 13 = 32 (out);
    // add bedrooms off-by-one (3) -> 35 (in), off-by-two (0) -> 32 (out).
    const city = lead({ propertyTypePref: null, propertyPurpose: null, budgetMin: null, budgetMax: null, bedroomPref: 4, preferredArea: "Chicago" });
    const inCity = (bedrooms: number) => property({ area: "Logan Square", city: "Chicago", bedrooms });
    assert.equal(score(city, inCity(3)).matchScore, 35);
    assert.equal(filterAndScoreProperties(city, [inCity(3)]).length, 1, "35 is kept");
    assert.equal(score(city, inCity(2)).matchScore, 32);
    assert.equal(filterAndScoreProperties(city, [inCity(2)]).length, 0, "32 is dropped");
  });

  it("returns best first, at most 8, and keeps input order for ties", () => {
    const rows = [
      property({ id: "tie-1", price: 1_500_000 }),
      property({ id: "best", price: 1_800_000 }),
      property({ id: "tie-2", price: 1_500_000 }),
      ...Array.from({ length: 9 }, (_, i) => property({ id: `x${i}`, price: 1_800_000, bedrooms: 3 })),
    ];
    const out = filterAndScoreProperties(lead(), rows);
    assert.equal(out.length, 8);
    assert.equal(out[0].property.id, "best");
    for (let i = 1; i < out.length; i++) assert.ok(out[i - 1].matchScore >= out[i].matchScore);
    const ids = out.map((m) => m.property.id);
    assert.ok(ids.indexOf("tie-1") < ids.indexOf("tie-2") || !ids.includes("tie-2"));
  });

  it("is deterministic and does not mutate its inputs", () => {
    const l = lead();
    const rows = [property({ id: "a" }), property({ id: "b", price: 45_000_000 })];
    const snapshot = JSON.stringify([l, rows]);
    const first = filterAndScoreProperties(l, rows);
    const second = filterAndScoreProperties(l, rows);
    assert.deepEqual(first, second);
    assert.equal(JSON.stringify([l, rows]), snapshot);
  });

  it("empty inventory and a lead with no preferences both return an empty list, not an error", () => {
    assert.deepEqual(filterAndScoreProperties(lead(), []), []);
    const blank = lead({ propertyTypePref: null, propertyPurpose: null, preferredArea: null, budgetMin: null, budgetMax: null, bedroomPref: null });
    assert.deepEqual(filterAndScoreProperties(blank, [property()]), [], "baselines alone (19) are below the floor");
  });
});
