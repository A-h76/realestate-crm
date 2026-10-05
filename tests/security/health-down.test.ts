import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it, mock } from "node:test";

/** Readiness while the database check fails: 503, and the body carries no detail. Separate file so the health module
 * can be replaced before the route is imported for the first time. */
describe("GET /api/health when the database check fails", () => {
  it("is 503 with only { status: 'error' }: no latency, no database field, no error text", async () => {
    mock.module(pathToFileURL(path.resolve("src/lib/health.ts")).href, {
      namedExports: { checkDatabaseHealth: async () => ({ ok: false, database: "error", latencyMs: 1234 }) },
    });
    const { GET } = await import("../../src/app/api/health/route");
    const res = await GET();
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { status: "error" });
  });
});
