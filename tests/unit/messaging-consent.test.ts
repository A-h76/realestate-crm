import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { consentAddress, isOptInMessage, isOptOutMessage } from "../../src/lib/messaging/consent";
import { describeOutboundBlock } from "../../src/lib/messaging/outbound-gate";

describe("isOptOutMessage — a standalone keyword only", () => {
  it("treats the recognized opt-out keywords as an opt-out, case and punctuation insensitive", () => {
    for (const body of [
      "STOP",
      "stop",
      "Stop.",
      "  stop  ",
      "STOPALL",
      "unsubscribe",
      "Cancel",
      "end",
      "QUIT",
      "optout",
      "opt-out",
      "revoke",
    ]) {
      assert.equal(isOptOutMessage(body), true, body);
    }
  });

  it("does NOT treat a sentence that merely contains 'stop' as a legal opt-out", () => {
    for (const body of [
      "stop sending me the Elm St listing, send Oak St instead",
      "can you stop by the open house?",
      "I'll stop at the bank first",
      "don't stop looking",
      "nonstop",
    ]) {
      assert.equal(isOptOutMessage(body), false, body);
    }
  });

  it("is not triggered by empty or missing text", () => {
    assert.equal(isOptOutMessage(""), false);
    assert.equal(isOptOutMessage(null), false);
    assert.equal(isOptOutMessage(undefined), false);
  });

  it("does not confuse an opt-in keyword for an opt-out", () => {
    assert.equal(isOptOutMessage("START"), false);
    assert.equal(isOptInMessage("START"), true);
    assert.equal(isOptInMessage("stop"), false);
  });
});

describe("consentAddress — one canonical key per person per channel", () => {
  it("keys SMS and WhatsApp on E.164, so a re-typed number cannot bypass a suppression", () => {
    for (const spelling of ["(415) 555-0123", "415-555-0123", "+1 415 555 0123", "4155550123"]) {
      assert.equal(consentAddress("SMS", spelling), "+14155550123", spelling);
      assert.equal(consentAddress("WHATSAPP", spelling), "+14155550123", spelling);
    }
  });

  it("keys e-mail case-insensitively", () => {
    assert.equal(consentAddress("EMAIL", "  Buyer@Example.COM "), "buyer@example.com");
  });

  it("returns null for an address it cannot canonicalize, so no consent record can be forged", () => {
    assert.equal(consentAddress("SMS", "555"), null);
    assert.equal(consentAddress("SMS", null), null);
    assert.equal(consentAddress("EMAIL", "not-an-email"), null);
  });
});

describe("outbound block reasons are explainable to a user", () => {
  it("gives a non-empty, non-technical message for every reason", () => {
    for (const reason of ["human_took_over", "ai_mode_draft", "consent_revoked", "consent_not_granted", "no_recipient"] as const) {
      const message = describeOutboundBlock(reason);
      assert.ok(message.length > 20, reason);
      assert.doesNotMatch(message, /undefined|null|_/, reason);
    }
  });
});
