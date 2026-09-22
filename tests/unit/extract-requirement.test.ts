import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractRequirement } from "../../src/lib/whatsapp/extract-requirement";

describe("extractRequirement", () => {
  it("parses a mixed Roman Urdu / English rental brief", () => {
    const out = extractRequirement("Aoa bhai 5 marla house DHA 2 mein rent pe chahiye 80k tak");
    assert.equal(out.propertyPurpose, "RENT");
    assert.equal(out.intentType, "RENT");
    assert.equal(out.propertyTypePref, "HOUSE");
    assert.equal(out.preferredArea, "DHA Phase 2");
    assert.equal(out.sizeUnitPref, "MARLA");
    assert.equal(out.sizePrefMin, 5);
    assert.equal(out.sizePrefMax, 5);
    assert.equal(out.budgetMax, 80_000);
  });

  it("parses a size/area/budget brief without guessing a purpose from a bare 'chahiye'", () => {
    // "chahiye" (want) alone is genuine buy/rent ambiguity — P0 #5's
    // conversational layer asks the customer explicitly rather than having
    // the extractor assume BUY, so purpose/intentType must stay unset here.
    const out = extractRequirement("1 kanal house Bahria Town mein chahiye, budget 150 lakh se 250 lakh tak");
    assert.equal(out.propertyPurpose, undefined);
    assert.equal(out.intentType, undefined);
    assert.equal(out.propertyTypePref, "HOUSE");
    assert.equal(out.preferredArea, "Bahria Town");
    assert.equal(out.sizeUnitPref, "KANAL");
    assert.equal(out.budgetMin, 15_000_000);
    assert.equal(out.budgetMax, 25_000_000);
  });

  it("returns nothing for chit-chat with no requirement signal", () => {
    const out = extractRequirement("Aoa, kesy hain aap?");
    assert.deepEqual(out, {});
  });

  it("detects a seller lead separately from a buyer lead", () => {
    const out = extractRequirement("Mujhe apna plot bechna hai Gulberg mein");
    assert.equal(out.propertyPurpose, "SALE");
    assert.equal(out.intentType, "SELL");
    assert.equal(out.propertyTypePref, "PLOT");
    assert.equal(out.preferredArea, "Gulberg");
  });
});
