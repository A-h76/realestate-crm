import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkDatabaseHealth } from "../../src/lib/health";

describe("checkDatabaseHealth", () => {
  it("reports ok against a reachable database", async () => {
    const result = await checkDatabaseHealth();
    assert.equal(result.ok, true);
    assert.equal(result.database, "ok");
    assert.equal(typeof result.latencyMs, "number");
    assert.ok(result.latencyMs >= 0);
  });
});
