import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { formatLogLine, logEvent, maskEmail, scrubString } from "../../src/lib/log";
import { logSecurityEvent } from "../../src/lib/security/log";

/** Structured logs: one JSON line per event, request id attached, credentials and message content never written. */
afterEach(() => mock.restoreAll());
const parse = (line: string) => JSON.parse(line) as Record<string, unknown>;

describe("formatLogLine", () => {
  it("is one JSON object with timestamp, level, event and the request id", () => {
    const line = formatLogLine("warn", "thing_happened", { count: 3 }, "req-123");
    assert.ok(!line.includes("\n"));
    const o = parse(line);
    assert.equal(o.level, "warn");
    assert.equal(o.event, "thing_happened");
    assert.equal(o.requestId, "req-123");
    assert.equal(o.count, 3);
    assert.ok(!Number.isNaN(Date.parse(o.ts as string)));
  });

  it("a caller field cannot overwrite the reserved keys", () => {
    const o = parse(formatLogLine("info", "real_event", { event: "forged", level: "debug", requestId: "forged" }, "req-1"));
    assert.equal(o.event, "real_event");
    assert.equal(o.level, "info");
    assert.equal(o.requestId, "req-1");
  });

  it("redacts credential, token, message-body and contact fields by key, including nested ones", () => {
    const o = parse(
      formatLogLine("error", "x", {
        password: "p4ss",
        accessToken: "tok",
        authorization: "Bearer abc",
        signature: "sha256=abc",
        body: "I want to buy a house in Lincoln Park, budget $1.8m",
        phone: "+14155550123",
        email: "a@b.com",
        nested: { api_key: "k", ok: "visible", deeper: { secret: "s" } },
        status: 401,
      }),
    );
    const text = JSON.stringify(o);
    for (const leak of ["p4ss", "Bearer abc", "sha256=abc", "Lincoln Park", "+14155550123", "a@b.com", '"k"', '"s"']) assert.ok(!text.includes(leak), `leaked ${leak}`);
    assert.equal((o.nested as Record<string, unknown>).ok, "visible");
    assert.equal(o.status, 401);
  });

  it("scrubs credentials inside ordinary strings; Errors keep only name and first message line", () => {
    const o = parse(
      formatLogLine("error", "x", {
        detail: `failed to reach ${"postgres" + "ql:"}//admin:hunter2@db.internal:5432/crm with Bearer eyJhbGciOiJIUzI1NiJ9.abc.def`,
        error: Object.assign(new Error("first line postgres://u:pw@h/db\n    at secretFunction (/srv/app/x.ts:1:1)"), { stack: "STACK" }),
      }),
    );
    const text = JSON.stringify(o);
    for (const leak of ["hunter2", "pw@", "eyJhbGci", "secretFunction", "STACK", "/srv/app"]) assert.ok(!text.includes(leak), `leaked ${leak}`);
    assert.equal((o.error as { name: string }).name, "Error");
  });

  it("truncates long strings and caps depth", () => {
    const o = parse(formatLogLine("info", "x", { long: "a b ".repeat(500), deep: { a: { b: { c: { d: 1 } } } } }));
    assert.ok((o.long as string).length <= 300);
    assert.ok(JSON.stringify(o.deep).includes("[truncated]"));
  });

  it("scrubString and maskEmail", () => {
    assert.equal(scrubString("see https://user:pw@host/x"), "see https://[redacted]@host/x");
    assert.equal(maskEmail("alice@example.com"), "a***@example.com");
    assert.equal(maskEmail("not-an-email"), "[redacted]");
  });
});

describe("logEvent and logSecurityEvent", () => {
  it("logEvent writes to the matching console level as a single line", () => {
    const lines: string[] = [];
    mock.method(console, "error", (l: string) => void lines.push(l));
    logEvent("error", "boom", { workspaceId: "w1" });
    assert.equal(lines.length, 1);
    assert.equal(parse(lines[0]).event, "boom");
  });

  it("security events are structured, carry status and message, and never the full email", () => {
    const lines: string[] = [];
    mock.method(console, "warn", (l: string) => void lines.push(l));
    logSecurityEvent({ status: 401, message: "login_failed: bad_password", detail: { account: maskEmail("victim@example.com") } });
    const o = parse(lines[0]);
    assert.equal(o.event, "security_event");
    assert.equal(o.status, 401);
    assert.equal(o.account, "v***@example.com");
    assert.ok(!lines[0].includes("victim@"));
  });
});
