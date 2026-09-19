import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { incrementMemory as incrementMemoryForTest, RATE_LIMITS } from "../../src/lib/rate-limit";

describe("Rate limiting", () => {
  it("documents production limits for high-risk surfaces", () => {
    assert.equal(RATE_LIMITS.login.limit, 5);
    assert.equal(RATE_LIMITS.webhook.limit, 120);
    assert.equal(RATE_LIMITS.csvImport.limit, 5);
    assert.equal(RATE_LIMITS.csvExport.limit, 10);
    assert.equal(RATE_LIMITS.demoReset.limit, 3);
    assert.ok(RATE_LIMITS.intelligence.limit <= 30);
  });

  it("counts against a window in the memory fallback used for tests", () => {
    const key = `test:${Date.now()}:${Math.random()}`;
    const first = incrementMemoryForTest(key, 60_000);
    const second = incrementMemoryForTest(key, 60_000);
    assert.equal(first.count, 1);
    assert.equal(second.count, 2);
    assert.ok(second.resetAt > Date.now() - 1000);
  });
});
