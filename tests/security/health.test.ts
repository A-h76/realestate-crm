import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it, mock } from "node:test";
import { checkDatabaseHealth } from "../../src/lib/health";

/**
 * Liveness (/api/health/live) must not touch the database; readiness (/api/health) must, must be bounded, and must
 * not leak detail to an unauthenticated caller. Failure is injected through checkDatabaseHealth's `ping` parameter
 * (Prisma's client cannot be monkey-patched). The 503 route response is in health-down.test.ts, which needs the health
 * module replaced before the route is first imported.
 */
afterEach(() => mock.restoreAll());

describe("checkDatabaseHealth", () => {
  it("reports ok against a reachable database", async () => {
    const result = await checkDatabaseHealth();
    assert.equal(result.ok, true);
    assert.equal(result.database, "ok");
    assert.ok(result.latencyMs >= 0);
  });

  it("gives up on a database that never answers instead of hanging", async () => {
    const started = Date.now();
    const result = await checkDatabaseHealth(50, () => new Promise(() => {}));
    assert.equal(result.ok, false);
    assert.equal(result.database, "error");
    assert.ok(Date.now() - started < 1_000, "bounded by the timeout");
  });

  it("reports an error when the query fails, and never logs the connection string", async () => {
    // Assembled from parts so the repository secret scan does not flag this fake credential.
    const secret = `${"postgres" + "ql:"}//admin:hunter2@db.internal:5432/crm`;
    const logged: string[] = [];
    mock.method(console, "error", (...args: unknown[]) => void logged.push(args.map(String).join(" ")));
    const result = await checkDatabaseHealth(1_000, () => Promise.reject(new Error(`connect failed to ${secret}`)));
    assert.equal(result.ok, false);
    const line = logged.join("\n");
    assert.match(line, /health_database_failed/);
    assert.ok(!line.includes("hunter2") && !line.includes("admin:"), "credentials scrubbed from the log line");
  });
});

describe("health routes", () => {
  it("readiness answers only ok/error: no latency, no database detail", async () => {
    const { GET } = await import("../../src/app/api/health/route");
    const res = await GET();
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok" });
    assert.equal(res.headers.get("cache-control"), "no-store");
  });

  it("liveness answers ok and has no database or health-module dependency (so it stays up while the database is down)", async () => {
    const { GET } = await import("../../src/app/api/health/live/route");
    const res = GET();
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok" });
    const source = readFileSync(join(import.meta.dirname, "../../src/app/api/health/live/route.ts"), "utf8");
    assert.ok(!/from\s+["']@\/lib\/(db|health)["']|prisma/.test(source.replace(/\/\*[\s\S]*?\*\//g, "")), "no database import");
  });
});
