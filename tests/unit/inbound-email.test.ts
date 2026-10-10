import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { verifySvixSignature } from "../../src/lib/security/svix";
import { looksAutomated, parseAddress } from "../../src/lib/webhooks/resend-inbound";

describe("Svix webhook signature (Resend)", () => {
  // Published Svix example vector.
  const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
  const id = "msg_p5jXN8AQM9LWM0D4loKWxJek";
  const timestamp = "1614265330";
  const body = '{"test": 2432232314}';
  const sig = "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=";
  const now = 1614265330 * 1000;

  it("accepts the reference vector, and any one valid signature among several", () => {
    assert.equal(verifySvixSignature(body, { id, timestamp, signature: sig }, secret, now), true);
    assert.equal(verifySvixSignature(body, { id, timestamp, signature: `v1,AAAA ${sig}` }, secret, now), true);
  });
  it("rejects a changed body, id, secret or missing header", () => {
    assert.equal(verifySvixSignature(body + " ", { id, timestamp, signature: sig }, secret, now), false);
    assert.equal(verifySvixSignature(body, { id: "msg_other", timestamp, signature: sig }, secret, now), false);
    assert.equal(verifySvixSignature(body, { id, timestamp, signature: sig }, "whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAA", now), false);
    assert.equal(verifySvixSignature(body, { id, timestamp, signature: null }, secret, now), false);
  });
  it("rejects a replay outside the 5 minute window", () => {
    assert.equal(verifySvixSignature(body, { id, timestamp, signature: sig }, secret, now + 6 * 60_000), false);
    assert.equal(verifySvixSignature(body, { id, timestamp, signature: sig }, secret, now + 4 * 60_000), true);
  });
});

describe("Inbound email parsing", () => {
  it("splits a display name from the address and lowercases it", () => {
    assert.deepEqual(parseAddress('"Sara Khan" <Sara@Example.COM>'), { name: "Sara Khan", email: "sara@example.com" });
    assert.deepEqual(parseAddress("sara@example.com"), { name: "sara", email: "sara@example.com" });
    assert.equal(parseAddress("not an address"), null);
    assert.equal(parseAddress(undefined), null);
  });
  it("treats machines as machines, people as people", () => {
    assert.equal(looksAutomated("no-reply@shop.example"), true);
    assert.equal(looksAutomated("mailer-daemon@shop.example"), true);
    assert.equal(looksAutomated("sara@example.com", { "Auto-Submitted": "auto-replied" }), true);
    assert.equal(looksAutomated("sara@example.com", { Precedence: "bulk" }), true);
    assert.equal(looksAutomated("sara@example.com", { "auto-submitted": "no" }), false);
    assert.equal(looksAutomated("sara@example.com"), false);
  });
});
