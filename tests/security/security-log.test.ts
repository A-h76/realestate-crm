import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { jsonError } from "../../src/lib/api";
import { ApiError } from "../../src/lib/errors";

async function captureWarn(fn: () => Promise<unknown> | unknown): Promise<string[]> {
  const original = console.warn;
  const lines: string[] = [];
  console.warn = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    await fn();
  } finally {
    console.warn = original;
  }
  return lines;
}

describe("jsonError security tracing", () => {
  it("logs a [SECURITY] trace for 401/403/429 failures", async () => {
    for (const status of [401, 403, 429]) {
      const lines = await captureWarn(() => jsonError(new ApiError(status, "denied")));
      assert.equal(lines.length, 1, `expected exactly one warn for status ${status}`);
      assert.match(lines[0], /\[SECURITY\]/);
      assert.match(lines[0], new RegExp(`status=${status}`));
    }
  });

  it("does not log a security trace for ordinary 404s", async () => {
    const lines = await captureWarn(() => jsonError(new ApiError(404, "Lead not found")));
    assert.equal(lines.length, 0);
  });
});
