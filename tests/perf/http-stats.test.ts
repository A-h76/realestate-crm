import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyHttp, durationStats } from "../../scripts/perf-stats";

describe("HTTP duration stats", () => {
  it("computes min median mean p95 max", () => {
    const stats = durationStats([100, 110, 90, 200, 105, 108, 102, 99, 250, 101]);
    assert.equal(stats.n, 10);
    assert.equal(stats.min, 90);
    assert.equal(stats.max, 250);
    assert.equal(stats.median, 103.5);
    assert.ok(Math.abs(stats.mean - 126.5) < 0.01);
    assert.equal(stats.p95, 250);
  });

  it("classifies diagnostic thresholds", () => {
    assert.equal(classifyHttp(50), "FAST");
    assert.equal(classifyHttp(400), "NORMAL");
    assert.equal(classifyHttp(800), "SLOW");
    assert.equal(classifyHttp(1500), "VERY_SLOW");
    assert.equal(classifyHttp(2500), "CRITICAL");
  });
});
