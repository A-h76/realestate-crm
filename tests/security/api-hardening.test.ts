import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { leadCreateSchema } from "../../src/lib/validations/leads";
import { ApiError } from "../../src/lib/errors";

describe("Client-controlled security fields", () => {
  it("ignores client-supplied lead scores", () => {
    const parsed = leadCreateSchema.parse({
      firstName: "Ali",
      leadScore: 99,
      fitScore: 99,
      intentScore: 99,
      valueScore: 99,
      workspaceId: "ws_attacker",
      role: "OWNER",
    });
    assert.equal("leadScore" in parsed, false);
    assert.equal("fitScore" in parsed, false);
    assert.equal("workspaceId" in parsed, false);
    assert.equal("role" in parsed, false);
  });
});

describe("API error hardening", () => {
  it("attaches Retry-After on 429 errors", () => {
    const error = new ApiError(429, "Too many requests", { "Retry-After": "30" });
    assert.equal(error.status, 429);
    assert.equal(error.headers?.["Retry-After"], "30");
    assert.equal(error.message.includes("passwordHash"), false);
  });
});
