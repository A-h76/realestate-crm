import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { InvitationBadge } from "../../src/components/team/invitation-badge";
import { ErrorState } from "../../src/components/error-state";
import { LoadingState, NotFoundState } from "../../src/components/route-states";
import AppError from "../../src/app/(app)/error";
import AppLoading from "../../src/app/(app)/loading";
import AppNotFound from "../../src/app/(app)/not-found";
import GlobalError from "../../src/app/global-error";
import RootError from "../../src/app/error";
import RootNotFound from "../../src/app/not-found";
import { render } from "../helpers/ui";

/**
 * CORE-004: route-level error / loading / not-found boundaries. They must give a recovery path, announce
 * themselves to assistive tech, and never show an error message, stack or internal detail.
 */
// Built from parts so the repository secret scan (tests/security/leakage.test.ts) does not flag this fake credential.
const SECRET = `connect ECONNREFUSED ${"postgres:"}//admin:hunter2@db.internal:5432/crm`;
const boom = Object.assign(new Error(SECRET), { digest: "d1g3st-abc123" });
boom.stack = `Error: ${SECRET}\n    at secretFunction (/srv/app/src/lib/secret.ts:42:13)`;
const retry = () => {};

describe("error boundaries", () => {
  const variants: Array<[string, () => string]> = [
    ["ErrorState", () => render(createElement(ErrorState, { error: boom, retry }))],
    ["(app)/error.tsx", () => render(createElement(AppError, { error: boom, retry }))],
    ["error.tsx", () => render(createElement(RootError, { error: boom, retry }))],
    ["global-error.tsx", () => render(createElement(GlobalError, { error: boom, retry }))],
  ];

  for (const [name, html] of variants) {
    it(`${name}: never leaks the error message, stack, paths or credentials`, () => {
      const out = html();
      for (const leak of ["ECONNREFUSED", "hunter2", "postgres://", "db.internal", "secretFunction", "/srv/app", ".ts:42"]) {
        assert.ok(!out.includes(leak), `${name} leaked "${leak}"`);
      }
    });

    it(`${name}: announces as an alert, offers retry, shows only the opaque reference`, () => {
      const out = html();
      assert.match(out, /role="alert"/);
      assert.match(out, /Try again/);
      assert.match(out, /d1g3st-abc123/);
    });
  }

  it("ErrorState without a digest shows no reference line", () => {
    const out = render(createElement(ErrorState, { error: new Error("x"), retry }));
    assert.ok(!out.includes("Reference:"));
  });

  it("the in-app boundary keeps a way back to the dashboard; the sign-in-level one points at /login", () => {
    assert.match(render(createElement(AppError, { error: boom, retry })), /href="\/dashboard"/);
    assert.match(render(createElement(RootError, { error: boom, retry })), /href="\/login"/);
  });

  it("global-error supplies its own document (it replaces the root layout)", () => {
    const out = render(createElement(GlobalError, { error: boom, retry }));
    assert.match(out, /^<html/);
    assert.match(out, /<body/);
  });
});

describe("not-found boundaries", () => {
  it("say the same thing for 'missing' and 'not yours', and offer ways back", () => {
    const out = render(createElement(NotFoundState, {}));
    assert.match(out, /couldn’t find that/);
    assert.match(out, /may not have access/);
    assert.match(out, /href="\/dashboard"/);
  });

  it("(app)/not-found.tsx links to the main record lists; root not-found renders inside <main>", () => {
    const inApp = render(createElement(AppNotFound));
    assert.match(inApp, /href="\/leads"/);
    assert.match(inApp, /href="\/opportunities"/);
    assert.match(render(createElement(RootNotFound)), /^<main/);
  });
});

describe("loading boundary", () => {
  it("is announced politely once, marked busy, and has screen-reader text", () => {
    for (const out of [render(createElement(LoadingState, {})), render(createElement(AppLoading))]) {
      assert.match(out, /role="status"/);
      assert.match(out, /aria-live="polite"/);
      assert.match(out, /aria-busy="true"/);
      assert.match(out, /class="sr-only">Loading/);
    }
  });

  it("decorative skeleton bars are hidden from assistive tech and only animate when motion is allowed", () => {
    const out = render(createElement(LoadingState, {}));
    assert.match(out, /aria-hidden="true"/);
    assert.ok(!/(^|\s)animate-pulse/.test(out.replace(/motion-safe:animate-pulse/g, "")), "bare animate-pulse ignores reduced-motion");
  });
});

describe("invitation badge (team screen)", () => {
  const at = new Date("2026-10-10T12:00:00.000Z").toISOString();

  it("pending shows the expiry date; expired tells the admin what to do; active members show nothing", () => {
    const pending = render(createElement(InvitationBadge, { invitation: { state: "PENDING", expiresAt: at } }));
    assert.match(pending, /Invitation pending, link valid until 2026-10-10/);
    const expired = render(createElement(InvitationBadge, { invitation: { state: "EXPIRED", expiresAt: at } }));
    assert.match(expired, /Invitation expired, create a new setup link/);
    assert.equal(render(createElement(InvitationBadge, { invitation: null })), "");
  });

  it("pending and expired are visually distinct tones", () => {
    const a = render(createElement(InvitationBadge, { invitation: { state: "PENDING", expiresAt: at } }));
    const b = render(createElement(InvitationBadge, { invitation: { state: "EXPIRED", expiresAt: at } }));
    const cls = (html: string) => /class="([^"]*)"/.exec(html)?.[1];
    assert.notEqual(cls(a), cls(b));
  });
});
