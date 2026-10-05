import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applySecurityHeaders, buildCsp, newNonce, SECURITY_HEADERS } from "../../src/lib/security/headers";

/**
 * SEC-010. What these tests prove: the policy builder never emits 'unsafe-inline' for scripts, a nonce is fresh per
 * request, and the response carries exactly one CSP that matches the nonce handed to the renderer. What they do NOT
 * prove: that every page's inline scripts really carry the nonce in a browser. That is checked against a running
 * production build by scripts/check-csp.ts (see docs/ops/RELEASE-RUNBOOK.md), which needs a built app and a database.
 */
const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

describe("buildCsp", () => {
  const csp = buildCsp("TESTNONCE", false);

  it("scripts need the request's nonce: no 'unsafe-inline', no 'unsafe-eval' in production", () => {
    const script = directive(csp, "script-src");
    assert.match(script, /'nonce-TESTNONCE'/);
    assert.match(script, /'strict-dynamic'/);
    assert.ok(!script.includes("'unsafe-inline'"));
    assert.ok(!script.includes("'unsafe-eval'"));
  });

  it("'unsafe-eval' appears only for the dev server", () => {
    assert.ok(directive(buildCsp("n", true), "script-src").includes("'unsafe-eval'"));
  });

  it("styles still allow 'unsafe-inline' (React style attributes): the policy is not claimed to be fully strict", () => {
    assert.ok(directive(csp, "style-src").includes("'unsafe-inline'"));
  });

  it("keeps the other hardening directives", () => {
    assert.equal(directive(csp, "frame-ancestors"), "frame-ancestors 'none'");
    assert.equal(directive(csp, "object-src"), "object-src 'none'");
    assert.equal(directive(csp, "base-uri"), "base-uri 'self'");
    assert.equal(directive(csp, "form-action"), "form-action 'self'");
    assert.equal(directive(csp, "default-src"), "default-src 'self'");
    assert.equal(directive(csp, "connect-src"), "connect-src 'self'");
  });
});

describe("nonce and header application", () => {
  it("nonces are unique and unguessable-looking across many requests", () => {
    const seen = new Set(Array.from({ length: 500 }, newNonce));
    assert.equal(seen.size, 500);
    for (const n of seen) assert.match(n, /^[A-Za-z0-9+/=]{40,}$/);
  });

  it("the static header list no longer carries a CSP (a second, nonce-less policy would be intersected with the real one)", () => {
    assert.ok(!SECURITY_HEADERS.some((h) => h.key === "Content-Security-Policy"));
  });

  it("applySecurityHeaders sets exactly one CSP carrying the given nonce, plus the static headers", () => {
    const headers = new Headers();
    applySecurityHeaders(headers, "ABC123");
    assert.match(headers.get("content-security-policy")!, /'nonce-ABC123'/);
    assert.equal(headers.get("x-frame-options"), "DENY");
    assert.equal(headers.get("x-content-type-options"), "nosniff");
  });
});
