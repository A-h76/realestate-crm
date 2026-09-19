import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CSV_LIMITS, escapeCsvCell, parseLeadCsv, toCsv } from "../../src/lib/csv/leads";
import { ApiError } from "../../src/lib/errors";

describe("CSV hardening", () => {
  it("rejects excessive row counts", () => {
    const header = "firstName,email";
    const rows = Array.from({ length: CSV_LIMITS.maxRows + 2 }, (_, i) => `Lead${i},lead${i}@example.com`);
    assert.throws(
      () => parseLeadCsv([header, ...rows].join("\n")),
      (error: unknown) => error instanceof ApiError && error.status === 413,
    );
  });

  it("protects spreadsheet formula injection on export", () => {
    assert.equal(escapeCsvCell("=cmd|' /C calc'!A0"), "'=cmd|' /C calc'!A0");
    assert.equal(escapeCsvCell("+1+1"), "'+1+1");
    assert.equal(escapeCsvCell("@SUM(A1)"), "'@SUM(A1)");
    assert.equal(escapeCsvCell("-1+1"), "'-1+1");
    assert.equal(escapeCsvCell(-500000), "-500000");
    assert.equal(escapeCsvCell("DHA Phase 6"), "DHA Phase 6");
  });

  it("encodes exported CSV with a BOM and escaped formula cells", () => {
    const csv = toCsv([{ firstName: "=1+1", notes: "ok" }]);
    assert.ok(csv.startsWith("\uFEFF"));
    assert.ok(csv.includes("'=1+1"));
    assert.ok(csv.includes("ok"));
  });

  it("does not accept a workspaceId column from the file", () => {
    const parsed = parseLeadCsv("firstName,workspaceId\nAli,ws_other\n");
    assert.equal(parsed.valid.length, 1);
    assert.equal("workspaceId" in parsed.valid[0], false);
    assert.equal(parsed.valid[0].firstName, "Ali");
  });

  it("rejects oversized CSV payloads", () => {
    const oversized = `${"a".repeat(CSV_LIMITS.maxBytes + 1)}`;
    assert.throws(
      () => parseLeadCsv(oversized),
      (error: unknown) => error instanceof ApiError && error.status === 413,
    );
  });
});
