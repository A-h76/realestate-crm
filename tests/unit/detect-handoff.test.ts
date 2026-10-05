import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectHandoff } from "../../src/lib/whatsapp/detect-handoff";
import { handoffTaskTag, isHandoffAlreadyOpen } from "../../src/lib/whatsapp/handoff-event";

function reason(message: string, previousMessage?: string) {
  const result = detectHandoff(message, { previousMessage });
  return result.shouldHandoff ? result.reason : null;
}

describe("detectHandoff — normal messages stay in the AI-assisted flow", () => {
  const normal = [
    "Hi",
    "Good morning",
    "can you send photos",
    "price?",
    "location?",
    "3 bedrooms please",
    "in Logan Square?",
    "is it a rental?",
  ];
  for (const message of normal) {
    it(`does not hand off "${message}"`, () => {
      assert.deepEqual(detectHandoff(message), { shouldHandoff: false });
    });
  }
});

describe("detectHandoff — explicit human request", () => {
  for (const message of [
    "I want to talk to an agent",
    "can someone call me",
    "I'd rather speak with a real person",
    "connect me with a realtor",
  ]) {
    it(`flags "${message}" as HUMAN_REQUESTED`, () => {
      assert.equal(reason(message), "HUMAN_REQUESTED");
    });
  }
});

describe("detectHandoff — showing intent", () => {
  for (const message of [
    "I'd like to see the place",
    "can we schedule a showing tomorrow?",
    "when is the open house?",
    "could we tour it this weekend?",
    "can I come by and take a look in person?",
  ]) {
    it(`flags "${message}" as SITE_VISIT_REQUESTED`, () => {
      assert.equal(reason(message), "SITE_VISIT_REQUESTED");
    });
  }
});

describe("detectHandoff — negotiation / final price", () => {
  for (const message of [
    "what's the final price?",
    "is the price negotiable?",
    "would they come down to $560k?",
    "I'd like to make an offer below asking",
    "any room on the price?",
  ]) {
    it(`flags "${message}" as NEGOTIATION_REQUESTED`, () => {
      assert.equal(reason(message), "NEGOTIATION_REQUESTED");
    });
  }
});

describe("detectHandoff — seller / document / legal / financing questions", () => {
  for (const message of [
    "are the disclosures available?",
    "can you put me in touch with the seller?",
    "has it had an inspection?",
    "what are the HOA dues?",
    "how much are the closing costs?",
    "will I qualify for a mortgage?",
    "what are the property taxes?",
  ]) {
    it(`flags "${message}" as HUMAN_REQUIRED_FOR_PROPERTY_DETAILS`, () => {
      assert.equal(reason(message), "HUMAN_REQUIRED_FOR_PROPERTY_DETAILS");
    });
  }
});

describe("detectHandoff — ambiguous / business-judgment requests", () => {
  it("flags a request to recommend a best-fit alternative area as ambiguous, not an AI decision", () => {
    assert.equal(
      reason("If there's nothing in Logan Square, which neighborhood is best for my budget?"),
      "UNSUPPORTED_OR_AMBIGUOUS_REQUEST",
    );
  });
  it("flags an ambiguous cancel request rather than guessing what's being cancelled", () => {
    assert.equal(reason("I need to cancel the Damen Ave one."), "UNSUPPORTED_OR_AMBIGUOUS_REQUEST");
  });
  it("flags a question about the best school district as business judgment", () => {
    assert.equal(reason("which area has the best school district?"), "UNSUPPORTED_OR_AMBIGUOUS_REQUEST");
  });
});

describe("detectHandoff — high intent", () => {
  for (const message of [
    "I'm ready to put in an offer",
    "how much earnest money do you need?",
    "when can we sign the lease?",
    "I'm ready to move forward",
    "can you send the rental application?",
  ]) {
    it(`flags "${message}" as HIGH_INTENT`, () => {
      assert.equal(reason(message), "HIGH_INTENT");
    });
  }
});

describe("detectHandoff — information the CRM does not have", () => {
  it("flags a request for the exact square footage as INFORMATION_UNAVAILABLE", () => {
    assert.equal(reason("what's the exact square footage?"), "INFORMATION_UNAVAILABLE");
  });
  it("flags an availability confirmation request as INFORMATION_UNAVAILABLE", () => {
    assert.equal(reason("can you confirm availability before we drive out?"), "INFORMATION_UNAVAILABLE");
  });
});

describe("detectHandoff — conversation context", () => {
  it("carries a showing ask forward onto a bare follow-up", () => {
    assert.equal(reason("tomorrow?", "I'd like to see the place"), "SITE_VISIT_REQUESTED");
  });
  it("does not treat the same bare token as a handoff without prior context", () => {
    assert.deepEqual(detectHandoff("tomorrow?"), { shouldHandoff: false });
  });
});

describe("detectHandoff — repeated / low-confidence messages", () => {
  it("flags a verbatim repeat of the previous message", () => {
    assert.equal(
      reason("what are you talking about", "what are you talking about"),
      "LOW_CONFIDENCE_OR_FAILED_ASSISTANCE",
    );
  });
  it("flags explicit confusion", () => {
    assert.equal(reason("I don't understand what you mean"), "LOW_CONFIDENCE_OR_FAILED_ASSISTANCE");
  });
  it("flags being ignored", () => {
    assert.equal(reason("nobody has gotten back to me"), "LOW_CONFIDENCE_OR_FAILED_ASSISTANCE");
  });
  it("does not flag an ordinary ambiguous message with no prior context", () => {
    assert.deepEqual(detectHandoff("ok great, thanks"), { shouldHandoff: false });
  });
});

describe("handoff idempotency predicate", () => {
  it("treats a lead with no open handoff task as not already open", () => {
    assert.equal(isHandoffAlreadyOpen([], "SITE_VISIT_REQUESTED"), false);
    assert.equal(isHandoffAlreadyOpen(["Unrelated task", null], "SITE_VISIT_REQUESTED"), false);
  });

  it("recognizes an already-open handoff of the same reason", () => {
    const description = `HUMAN HANDOFF REQUIRED\n...\n\n${handoffTaskTag("SITE_VISIT_REQUESTED")}`;
    assert.equal(isHandoffAlreadyOpen([description], "SITE_VISIT_REQUESTED"), true);
  });

  it("does not dedupe across different reasons for the same lead", () => {
    const description = `HUMAN HANDOFF REQUIRED\n...\n\n${handoffTaskTag("SITE_VISIT_REQUESTED")}`;
    assert.equal(isHandoffAlreadyOpen([description], "NEGOTIATION_REQUESTED"), false);
  });
});
