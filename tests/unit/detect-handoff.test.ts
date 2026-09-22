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
    "Aoa",
    "Hi",
    "pics bhej dein",
    "price?",
    "location?",
    "5 marla chahiye",
    "DHA 2 mein?",
    "rent pe hai?",
  ];
  for (const message of normal) {
    it(`does not hand off "${message}"`, () => {
      assert.deepEqual(detectHandoff(message), { shouldHandoff: false });
    });
  }
});

describe("detectHandoff — explicit human request", () => {
  for (const message of ["agent se baat karni hai", "call karwa dein", "I want to talk to an agent"]) {
    it(`flags "${message}" as HUMAN_REQUESTED`, () => {
      assert.equal(reason(message), "HUMAN_REQUESTED");
    });
  }
});

describe("detectHandoff — site visit intent", () => {
  for (const message of ["property dekhni hai", "kal visit ho sakti hai?", "site visit kab ho sakti hai?"]) {
    it(`flags "${message}" as SITE_VISIT_REQUESTED`, () => {
      assert.equal(reason(message), "SITE_VISIT_REQUESTED");
    });
  }
});

describe("detectHandoff — negotiation / final price", () => {
  for (const message of ["final price kya hai?", "80k mein final ho jayega?", "thora kam ho sakta hai?"]) {
    it(`flags "${message}" as NEGOTIATION_REQUESTED`, () => {
      assert.equal(reason(message), "NEGOTIATION_REQUESTED");
    });
  }
});

describe("detectHandoff — owner / document / legal questions", () => {
  for (const message of ["documents available hain?", "owner se baat karwa dein", "registry hai?"]) {
    it(`flags "${message}" as HUMAN_REQUIRED_FOR_PROPERTY_DETAILS`, () => {
      assert.equal(reason(message), "HUMAN_REQUIRED_FOR_PROPERTY_DETAILS");
    });
  }
});

describe("detectHandoff — extended owner / legal / financing questions", () => {
  for (const message of ["Is property ka owner genuine hai?", "Legal issue to nahi?", "Loan mil jayega?", "mortgage ka legal process samjhao"]) {
    it(`flags "${message}" as HUMAN_REQUIRED_FOR_PROPERTY_DETAILS`, () => {
      assert.equal(reason(message), "HUMAN_REQUIRED_FOR_PROPERTY_DETAILS");
    });
  }
});

describe("detectHandoff — extended negotiation phrasing", () => {
  it('flags "45k mein karwa do." as NEGOTIATION_REQUESTED', () => {
    assert.equal(reason("45k mein karwa do."), "NEGOTIATION_REQUESTED");
  });
});

describe("detectHandoff — ambiguous / business-judgment requests", () => {
  it("flags a request to recommend a best-fit alternative area as ambiguous, not an AI decision", () => {
    assert.equal(reason("DHA 2 mein nahi hai to mere budget mein best area konsa hai?"), "UNSUPPORTED_OR_AMBIGUOUS_REQUEST");
  });
  it("flags an ambiguous cancel request rather than guessing what's being cancelled", () => {
    assert.equal(reason("Phase 2 wali property cancel karni hai."), "UNSUPPORTED_OR_AMBIGUOUS_REQUEST");
  });
});

describe("detectHandoff — high intent", () => {
  for (const message of ["booking karni hai", "token kitna hai?", "deal final karni hai?"]) {
    it(`flags "${message}" as HIGH_INTENT`, () => {
      assert.equal(reason(message), "HIGH_INTENT");
    });
  }
});

describe("detectHandoff — information the CRM does not have", () => {
  it("flags a request for an amount the system never stores as INFORMATION_UNAVAILABLE", () => {
    assert.equal(reason("negotiable kitna hai?"), "INFORMATION_UNAVAILABLE");
  });
  it("flags an availability confirmation request as INFORMATION_UNAVAILABLE", () => {
    assert.equal(reason("latest availability confirm hai?"), "INFORMATION_UNAVAILABLE");
  });
});

describe("detectHandoff — conversation context", () => {
  it("carries a site-visit ask forward onto a bare follow-up", () => {
    assert.equal(reason("kal?", "Property visit karni hai"), "SITE_VISIT_REQUESTED");
  });
  it("does not treat the same bare token as a handoff without prior context", () => {
    assert.deepEqual(detectHandoff("kal?"), { shouldHandoff: false });
  });
});

describe("detectHandoff — repeated / low-confidence messages", () => {
  it("flags a verbatim repeat of the previous message", () => {
    assert.equal(reason("kya bol rahe ho aap", "kya bol rahe ho aap"), "LOW_CONFIDENCE_OR_FAILED_ASSISTANCE");
  });
  it("flags explicit confusion", () => {
    assert.equal(reason("mujhe samajh nahi aa raha"), "LOW_CONFIDENCE_OR_FAILED_ASSISTANCE");
  });
  it("does not flag an ordinary ambiguous message with no prior context", () => {
    assert.deepEqual(detectHandoff("acha theek hai shukriya"), { shouldHandoff: false });
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
