import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isDemoMode } from "../../src/lib/demo-mode";

describe("Demo Mode fail-closed", () => {
  it("defaults to false when DEMO_MODE is unset", () => {
    const previous = process.env.DEMO_MODE;
    delete process.env.DEMO_MODE;
    assert.equal(isDemoMode(), false);
    if (previous !== undefined) process.env.DEMO_MODE = previous;
  });

  it("defaults to false when DEMO_MODE is any value other than true", () => {
    const previous = process.env.DEMO_MODE;
    process.env.DEMO_MODE = "false";
    assert.equal(isDemoMode(), false);
    process.env.DEMO_MODE = "1";
    assert.equal(isDemoMode(), false);
    process.env.DEMO_MODE = "TRUE";
    assert.equal(isDemoMode(), false);
    if (previous !== undefined) process.env.DEMO_MODE = previous;
    else delete process.env.DEMO_MODE;
  });

  it("enables only when DEMO_MODE is exactly true", () => {
    const previous = process.env.DEMO_MODE;
    process.env.DEMO_MODE = "true";
    assert.equal(isDemoMode(), true);
    if (previous !== undefined) process.env.DEMO_MODE = previous;
    else delete process.env.DEMO_MODE;
  });
});
