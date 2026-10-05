import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalPhone, formatPhone, isValidPhone, parsePhone } from "../../src/lib/phone";
import { canonicalPhone as identityCanonical, duplicateWhere, identityKeys, phoneVariants } from "../../src/lib/leads/identity";

describe("parsePhone — valid US numbers normalize to one E.164 identity", () => {
  it("accepts every common US spelling of the same number", () => {
    for (const input of [
      "(415) 555-0123",
      "415-555-0123",
      "415.555.0123",
      "4155550123",
      "1-415-555-0123",
      "+1 415-555-0123",
      "+14155550123",
      " 415 555 0123 ",
    ]) {
      assert.equal(canonicalPhone(input), "+14155550123", input);
    }
  });

  it("reports the parsed country and national format", () => {
    const parsed = parsePhone("(415) 555-0123");
    assert.ok(parsed.ok);
    assert.equal(parsed.e164, "+14155550123");
    assert.equal(parsed.national, "(415) 555-0123");
    assert.equal(parsed.country, "US");
  });

  it("never mangles a 10-digit US number into a foreign country code (the old normalizePkPhone bug)", () => {
    // normalizePkPhone turned these into +4155550123 (Switzerland) and +9175550188.
    assert.equal(canonicalPhone("415-555-0123"), "+14155550123");
    assert.equal(canonicalPhone("917-555-0188"), "+19175550188");
    assert.equal(canonicalPhone("(301) 555-0123"), "+13015550123");
  });
});

describe("parsePhone — invalid, incomplete and ambiguous input is rejected, not coerced", () => {
  it("rejects rather than silently corrupting", () => {
    const cases: Array<[string | null | undefined, string]> = [
      [null, "empty"],
      [undefined, "empty"],
      ["", "empty"],
      ["   ", "empty"],
      ["n/a", "not-a-number"],
      ["call me", "not-a-number"],
      ["555", "invalid-for-region"],
      ["415555012", "invalid-for-region"],
      ["41555501234567", "invalid-for-region"],
      ["+9999999999999999", "unsupported-region"],
    ];
    for (const [input, reason] of cases) {
      const parsed = parsePhone(input);
      assert.equal(parsed.ok, false, `${input} should be rejected`);
      assert.equal(!parsed.ok && parsed.reason, reason, `${input}`);
      assert.equal(canonicalPhone(input), null);
      assert.equal(isValidPhone(input), false);
    }
  });

  it("rejects a number whose area code does not exist, which a digit count alone would accept", () => {
    assert.equal(canonicalPhone("000-555-0123"), null);
    assert.equal(canonicalPhone("123-456-7890"), null);
  });
});

describe("parsePhone — region is explicit, never guessed", () => {
  it("honors the country code when the caller typed one, even outside the default region", () => {
    assert.equal(canonicalPhone("+44 20 7183 8750"), "+442071838750");
    assert.equal(canonicalPhone("+33 1 42 68 53 00"), "+33142685300");
  });

  it("interprets a bare national number as the region it is told, not as a prior market's", () => {
    assert.equal(canonicalPhone("020 7183 8750", "GB"), "+442071838750");
    // The same digits are not a valid US number, so the US region rejects them.
    assert.equal(canonicalPhone("020 7183 8750", "US"), null);
  });
});

describe("formatPhone — display is separate from stored identity", () => {
  it("shows national format for an in-region number and E.164 for a foreign one", () => {
    assert.equal(formatPhone("+14155550123"), "(415) 555-0123");
    assert.equal(formatPhone("+442071838750"), "+442071838750");
  });

  it("falls back to the stored string rather than hiding an unparseable legacy value", () => {
    assert.equal(formatPhone("ext. 4121"), "ext. 4121");
    assert.equal(formatPhone(null), "—");
  });
});

describe("lead identity and deduplication", () => {
  it("produces a phone identity key for a US number (previously none, so every US lead duplicated)", () => {
    assert.deepEqual(identityKeys({ phone: "(415) 555-0123" }), ["p:+14155550123"]);
  });

  it("treats every spelling of one number as the same identity, so a re-typed number still dedupes", () => {
    const keys = identityKeys({ phone: "415-555-0123", whatsappNumber: "+1 (415) 555-0123" });
    assert.deepEqual(keys, ["p:+14155550123"], "both fields collapse to one key");
  });

  it("keys e-mail and phone independently and sorts them for deterministic lock ordering", () => {
    assert.deepEqual(identityKeys({ phone: "4155550123", email: "Buyer@Example.COM" }), [
      "e:buyer@example.com",
      "p:+14155550123",
    ]);
  });

  it("produces no identity key at all for an invalid number, so it can never false-match", () => {
    assert.deepEqual(identityKeys({ phone: "555" }), []);
    assert.equal(identityCanonical("555"), null);
    assert.equal(duplicateWhere("ws_1", { phone: "555" }), null, "no phone key means no duplicate clause");
  });

  it("searches the stored spellings a legacy or as-typed row may hold", () => {
    const variants = phoneVariants("+14155550123");
    for (const expected of ["+14155550123", "14155550123", "4155550123", "(415) 555-0123", "415-555-0123"]) {
      assert.ok(variants.includes(expected), `${expected} missing from ${variants.join(", ")}`);
    }
  });

  it("builds a duplicate query scoped to the workspace and excluding soft-deleted leads", () => {
    const where = duplicateWhere("ws_1", { phone: "(415) 555-0123", email: "a@b.com" });
    assert.ok(where);
    assert.equal(where.workspaceId, "ws_1");
    assert.equal(where.deletedAt, null);
    assert.ok(Array.isArray(where.OR) && where.OR.length === 3, "phone+whatsapp variants and e-mail");
  });

  it("does not match two different people who merely share an area code", () => {
    assert.notEqual(identityKeys({ phone: "415-555-0123" })[0], identityKeys({ phone: "415-555-0124" })[0]);
  });
});
