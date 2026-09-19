import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyDuration, createRequestId, attachRequestId } from "../../src/lib/perf";
import { FETCH_TIMEOUTS_MS } from "../../src/lib/http";
import { CSV_LIMITS, parseLeadCsv } from "../../src/lib/csv/leads";
import { verifyHubSignature256 } from "../../src/lib/security/hmac";
import { createHmac } from "node:crypto";
import bcrypt from "bcryptjs";

function csvForRows(n: number) {
  const header = "firstName,email,phone,source";
  const rows = Array.from({ length: n }, (_, i) => `Lead${i},lead${i}@example.com,+92300111${String(i).padStart(4, "0")},WALK_IN`);
  return [header, ...rows].join("\n");
}

describe("performance instrumentation", () => {
  it("classifies diagnostic duration thresholds", () => {
    assert.equal(classifyDuration(50), "FAST");
    assert.equal(classifyDuration(199), "FAST");
    assert.equal(classifyDuration(200), "NORMAL");
    assert.equal(classifyDuration(499), "NORMAL");
    assert.equal(classifyDuration(500), "SLOW");
    assert.equal(classifyDuration(999), "SLOW");
    assert.equal(classifyDuration(1000), "VERY_SLOW");
    assert.equal(classifyDuration(1999), "VERY_SLOW");
    assert.equal(classifyDuration(2000), "CRITICAL");
  });

  it("accepts only safe request id characters", () => {
    assert.equal(createRequestId("req_abc-123"), "req_abc-123");
    assert.notEqual(createRequestId("x".repeat(8) + " password=secret"), "x".repeat(8) + " password=secret");
    assert.match(createRequestId(null), /^[0-9a-f-]{36}$/i);
  });

  it("clones responses when attaching request ids so Auth.js headers stay intact", () => {
    const original = new Response(null, {
      status: 302,
      headers: { location: "/dashboard", "set-cookie": "authjs.session-token=test" },
    });
    const next = attachRequestId(original, "req_test-id");
    assert.equal(next.status, 302);
    assert.equal(next.headers.get("location"), "/dashboard");
    assert.equal(next.headers.get("x-request-id"), "req_test-id");
    assert.match(next.headers.get("set-cookie") ?? "", /authjs\.session-token=test/);
  });
});

describe("external fetch timeouts", () => {
  it("uses provider-specific hang deadlines", () => {
    assert.equal(FETCH_TIMEOUTS_MS.upstash, 800);
    assert.equal(FETCH_TIMEOUTS_MS.openMeteo, 2500);
    assert.equal(FETCH_TIMEOUTS_MS.whatsappGraph, 8000);
    assert.equal(FETCH_TIMEOUTS_MS.googleCalendar, 8000);
    assert.ok(FETCH_TIMEOUTS_MS.upstash < FETCH_TIMEOUTS_MS.openMeteo);
    assert.ok(FETCH_TIMEOUTS_MS.openMeteo < FETCH_TIMEOUTS_MS.whatsappGraph);
  });
});

describe("CSV parse timing", () => {
  it("parses 100 and 500 rows within the security row cap", () => {
    const t100 = performance.now();
    const parsed100 = parseLeadCsv(csvForRows(100));
    const d100 = performance.now() - t100;
    assert.equal(parsed100.valid.length, 100);
    assert.ok(d100 >= 0);

    const t500 = performance.now();
    const parsed500 = parseLeadCsv(csvForRows(500));
    const d500 = performance.now() - t500;
    assert.equal(parsed500.valid.length, CSV_LIMITS.maxRows);
    assert.ok(d500 >= d100 || d500 < 50);

    console.info(`[PERF] operation=csv.parse.100 duration=${Math.round(d100)}ms`);
    console.info(`[PERF] operation=csv.parse.500 duration=${Math.round(d500)}ms`);
  });

  it("does not parse 1,000 rows because the architecture rejects them", () => {
    assert.throws(() => parseLeadCsv(csvForRows(1000)));
  });
});

describe("auth and webhook CPU timings", () => {
  it("times bcrypt compare separately from application latency", async () => {
    const hash = await bcrypt.hash("demo-only-not-a-secret", 10);
    const started = performance.now();
    const ok = await bcrypt.compare("demo-only-not-a-secret", hash);
    const duration = performance.now() - started;
    assert.equal(ok, true);
    console.info(`[PERF] operation=auth.passwordVerify duration=${Math.round(duration)}ms`);
    assert.ok(duration > 10, "bcrypt should be intentionally expensive");
  });

  it("times webhook HMAC verification", () => {
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
    const secret = "test-app-secret";
    const signature = `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
    const started = performance.now();
    const valid = verifyHubSignature256(body, signature, secret);
    const duration = performance.now() - started;
    assert.equal(valid, true);
    console.info(`[PERF] operation=webhook.signature duration=${duration.toFixed(2)}ms`);
  });
});
