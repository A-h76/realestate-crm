import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractRequirement } from "../../src/lib/whatsapp/extract-requirement";

describe("extractRequirement", () => {
  it("parses a full rental brief", () => {
    const out = extractRequirement("Hi, looking to rent a 3 bedroom townhouse in Logan Square, up to $2,900/mo");
    assert.equal(out.propertyPurpose, "RENT");
    assert.equal(out.intentType, "RENT");
    assert.equal(out.propertyTypePref, "TOWNHOUSE");
    assert.equal(out.preferredArea, "Logan Square");
    assert.equal(out.bedroomPref, 3);
    assert.equal(out.budgetMax, 2_900);
  });

  it("parses square footage and a budget range for a purchase", () => {
    const out = extractRequirement(
      "We want to buy a single-family home in Naperville, at least 2,400 sq ft, between 500k and 750k",
    );
    assert.equal(out.propertyPurpose, "SALE");
    assert.equal(out.intentType, "BUY");
    assert.equal(out.propertyTypePref, "SINGLE_FAMILY");
    assert.equal(out.preferredArea, "Naperville");
    assert.equal(out.sizeUnitPref, "SQFT");
    assert.equal(out.sizePrefMin, 2_400);
    assert.equal(out.budgetMin, 500_000);
    assert.equal(out.budgetMax, 750_000);
  });

  it("does not guess a purpose from a bare 'looking for'", () => {
    // Genuine buy/rent ambiguity: the conversational layer asks the customer explicitly
    // rather than having the extractor assume BUY, so purpose/intentType stay unset.
    const out = extractRequirement("Looking for a condo in Wicker Park, 3 bedrooms, around $600k");
    assert.equal(out.propertyPurpose, undefined);
    assert.equal(out.intentType, undefined);
    assert.equal(out.propertyTypePref, "CONDO");
    assert.equal(out.preferredArea, "Wicker Park");
    assert.equal(out.bedroomPref, 3);
    assert.equal(out.budgetMax, 600_000);
  });

  it("returns nothing for chit-chat with no requirement signal", () => {
    assert.deepEqual(extractRequirement("Hi, how are you?"), {});
  });

  it("detects a seller lead separately from a buyer lead", () => {
    const out = extractRequirement("I want to sell my condo in Hyde Park");
    assert.equal(out.propertyPurpose, "SALE");
    assert.equal(out.intentType, "SELL");
    assert.equal(out.propertyTypePref, "CONDO");
    assert.equal(out.preferredArea, "Hyde Park");
  });

  it("treats land acreage separately from finished square footage", () => {
    const out = extractRequirement("Buying 5 acres of vacant land near Boerne under $400k");
    assert.equal(out.propertyTypePref, "LAND");
    assert.equal(out.sizeUnitPref, "ACRE");
    assert.equal(out.sizePrefMin, 5);
    assert.equal(out.budgetMax, 400_000);
  });
});
