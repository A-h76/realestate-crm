import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/lib/db";
import { isSessionRowActive, revokeUserSessions, verifyLoginCredentials } from "../../src/lib/auth";
import { incrementMemory, loginRateLimits } from "../../src/lib/rate-limit";
import { clientIp } from "../../src/lib/security/request";
import { isCrossOriginMutation, isOversizedBody, isPublicPath } from "../../src/lib/security/request-guards";
import { MAX_FIELD_CHARS, parseBody } from "../../src/lib/validations/common";
import { noteCreateSchema } from "../../src/lib/validations/notes";
import { ApiError } from "../../src/lib/errors";

const root = join(import.meta.dirname, "../..");
const HOUR = 60 * 60 * 1000;

describe("Server-side session validity (F-02)", () => {
  const now = new Date("2026-09-27T12:00:00Z");
  const live = { userId: "u1", expiresAt: new Date(now.getTime() + HOUR), revokedAt: null, user: { deletedAt: null } };

  it("accepts a live session for the same user", () => {
    assert.equal(isSessionRowActive(live, "u1", now), true);
  });
  it("rejects a missing row (token issued before sids / forged sid)", () => {
    assert.equal(isSessionRowActive(null, "u1", now), false);
  });
  it("rejects a revoked session (logout / member removal)", () => {
    assert.equal(isSessionRowActive({ ...live, revokedAt: now }, "u1", now), false);
  });
  it("rejects an expired session (absolute lifetime)", () => {
    assert.equal(isSessionRowActive({ ...live, expiresAt: new Date(now.getTime() - 1) }, "u1", now), false);
  });
  it("rejects a sid belonging to another user", () => {
    assert.equal(isSessionRowActive(live, "attacker", now), false);
  });
  it("rejects a soft-deleted user", () => {
    assert.equal(isSessionRowActive({ ...live, user: { deletedAt: now } }, "u1", now), false);
  });
});

describe("Session revocation against the database (F-02)", () => {
  let userId: string;

  before(async () => {
    const user = await prisma.user.create({
      data: { email: `session-test-${randomUUID()}@example.com`, name: "Session Test", passwordHash: "x" },
    });
    userId = user.id;
  });
  after(async () => {
    await prisma.user.delete({ where: { id: userId } });
  });

  it("revokeUserSessions kills every live session of that user", async () => {
    const ids = [randomBytes(32).toString("base64url"), randomBytes(32).toString("base64url")];
    for (const id of ids) {
      await prisma.authSession.create({ data: { id, userId, expiresAt: new Date(Date.now() + HOUR) } });
    }
    assert.equal(await revokeUserSessions(userId), 2);
    const rows = await prisma.authSession.findMany({
      where: { id: { in: ids } },
      select: { userId: true, expiresAt: true, revokedAt: true, user: { select: { deletedAt: true } } },
    });
    assert.equal(rows.every((row) => !isSessionRowActive(row, userId)), true);
  });
});

describe("Login timing does not reveal account existence (F-10)", () => {
  it("spends a bcrypt verification on unknown emails", async () => {
    const start = performance.now();
    const result = await verifyLoginCredentials({ email: `nobody-${randomUUID()}@example.com`, password: "guess" });
    assert.equal(result.ok, false);
    assert.ok(performance.now() - start > 20, "unknown-user path returned without hashing");
  });
});

describe("Login rate limiting cannot be bypassed (F-03)", () => {
  it("ignores a client-supplied leftmost X-Forwarded-For", () => {
    const spoofed = new Request("http://x/", { headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.9" } });
    assert.equal(clientIp(spoofed), "203.0.113.9");
  });
  it("prefers the edge-set X-Real-IP", () => {
    const req = new Request("http://x/", { headers: { "x-real-ip": "198.51.100.7", "x-forwarded-for": "6.6.6.6" } });
    assert.equal(clientIp(req), "198.51.100.7");
  });
  it("falls back past a malformed X-Real-IP instead of poisoning the rate-limit key (SEC-003)", () => {
    const req = new Request("http://x/", {
      headers: { "x-real-ip": "<script>evil", "x-forwarded-for": "6.6.6.6, 203.0.113.9" },
    });
    assert.equal(clientIp(req), "203.0.113.9");
  });
  it("returns unknown when nothing looks like a real IP", () => {
    const req = new Request("http://x/", { headers: { "x-real-ip": "not-an-ip" } });
    assert.equal(clientIp(req), "unknown");
  });
  it("limits an account even when every attempt comes from a new IP (credential stuffing)", () => {
    const email = `victim-${randomUUID()}@example.com`;
    let emailCount = 0;
    for (let i = 0; i < 11; i++) {
      const perEmail = loginRateLimits(`10.0.0.${i}`, email)[1];
      emailCount = incrementMemory(perEmail.key, perEmail.windowMs).count;
    }
    assert.ok(emailCount > loginRateLimits("x", email)[1].limit);
  });
  it("limits an IP even when it rotates emails (password spraying)", () => {
    const ip = `192.0.2.${Math.floor(Math.random() * 250)}-${randomUUID()}`;
    let ipCount = 0;
    for (let i = 0; i < 31; i++) {
      const perIp = loginRateLimits(ip, `user${i}@example.com`)[2];
      ipCount = incrementMemory(perIp.key, perIp.windowMs).count;
    }
    assert.ok(ipCount > loginRateLimits(ip, "x")[2].limit);
  });
  it("keeps the documented bucket sizes", () => {
    assert.deepEqual(loginRateLimits("ip", "e").map((spec) => spec.limit), [5, 10, 30]);
  });
});

describe("CSRF origin check on API mutations (F-05)", () => {
  const h = (init: Record<string, string>) => new Headers({ host: "crm.example.com", ...init });

  it("rejects a cross-origin POST/PATCH/DELETE", () => {
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      assert.equal(isCrossOriginMutation(method, "/api/leads/abc", h({ origin: "https://evil.example.com" })), true);
    }
  });
  it("rejects Sec-Fetch-Site: cross-site even without Origin", () => {
    assert.equal(isCrossOriginMutation("POST", "/api/leads", h({ "sec-fetch-site": "cross-site" })), true);
  });
  it("rejects a malformed Origin", () => {
    assert.equal(isCrossOriginMutation("POST", "/api/leads", h({ origin: "null" })), true);
  });
  it("allows same-origin mutations and safe methods", () => {
    assert.equal(isCrossOriginMutation("POST", "/api/leads", h({ origin: "https://crm.example.com" })), false);
    assert.equal(isCrossOriginMutation("GET", "/api/leads", h({ origin: "https://evil.example.com" })), false);
  });
  it("honours X-Forwarded-Host behind the edge proxy", () => {
    const headers = new Headers({ host: "internal:8080", "x-forwarded-host": "crm.example.com", origin: "https://crm.example.com" });
    assert.equal(isCrossOriginMutation("DELETE", "/api/leads/1", headers), false);
  });
  it("exempts the HMAC webhook and Auth.js (own CSRF token)", () => {
    assert.equal(isCrossOriginMutation("POST", "/api/webhooks/whatsapp", h({ origin: "https://graph.facebook.com" })), false);
    assert.equal(isCrossOriginMutation("POST", "/api/auth/callback/credentials", h({ origin: "https://evil.example.com" })), false);
  });
});

describe("Public paths and intake forms", () => {
  const h = (o: Record<string, string>) => new Headers(o);
  it("the intake form endpoint and Meta webhook are reachable without a session; the CRM API is not", () => {
    for (const p of ["/api/intake/forms/abc123", "/api/webhooks/meta", "/api/webhooks/whatsapp", "/api/auth/session", "/login"]) assert.equal(isPublicPath(p), true, p);
    for (const p of ["/api/leads", "/api/intakefake", "/api/webhooks/other", "/dashboard"]) assert.equal(isPublicPath(p), false, p);
  });
  it("intake forms accept cross-site posts (they enforce their own origin allow-list); the CRM API still does not", () => {
    assert.equal(isCrossOriginMutation("POST", "/api/intake/forms/abc123", h({ origin: "https://shop.example", "sec-fetch-site": "cross-site" })), false);
    assert.equal(isCrossOriginMutation("POST", "/api/leads", h({ origin: "https://shop.example", "sec-fetch-site": "cross-site" })), true);
  });
});

describe("Oversized input is rejected (F-06)", () => {
  it("rejects API bodies over 1MB, allowing 2MB for CSV import", () => {
    const big = new Headers({ "content-length": String(1_048_577) });
    assert.equal(isOversizedBody("/api/notes", big), true);
    assert.equal(isOversizedBody("/api/leads/csv", big), false);
    assert.equal(isOversizedBody("/api/leads/csv", new Headers({ "content-length": String(3_000_000) })), true);
  });
  it("rejects any single string field over the cap, however deeply nested", () => {
    assert.throws(
      () => parseBody(noteCreateSchema, { body: "a".repeat(MAX_FIELD_CHARS + 1) }),
      (error: unknown) => error instanceof ApiError && error.status === 400,
    );
    assert.throws(() => parseBody(noteCreateSchema, { body: "ok", extra: { deep: ["x".repeat(MAX_FIELD_CHARS + 1)] } }));
    assert.equal(parseBody(noteCreateSchema, { body: "a".repeat(MAX_FIELD_CHARS) }).body.length, MAX_FIELD_CHARS);
  });
});

describe("Pages authorize through the DAL, not the JWT (F-01)", () => {
  function pages(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return pages(full);
      return name === "page.tsx" ? [full] : [];
    });
  }

  it("every (app) page that reads Prisma calls requireAppAccess and never trusts session.user.workspaceId", () => {
    const offenders = pages(join(root, "src/app/(app)")).filter((file) => {
      const src = readFileSync(file, "utf8");
      return (src.includes("prisma.") && !src.includes("requireAppAccess()")) || src.includes("session.user.workspaceId");
    });
    assert.deepEqual(offenders, []);
  });

  it("uses the Next 16 proxy convention and ships the session guards", () => {
    assert.equal(existsSync(join(root, "src/middleware.ts")), false);
    const proxy = readFileSync(join(root, "src/proxy.ts"), "utf8");
    assert.ok(proxy.includes("isCrossOriginMutation"));
    assert.ok(proxy.includes("no-store"));
  });

  it("names the production session cookie with the __Host- prefix, HttpOnly", () => {
    const auth = readFileSync(join(root, "src/lib/auth.ts"), "utf8");
    assert.ok(auth.includes('"__Host-synas_session"'));
    assert.match(auth, /httpOnly: true, sameSite: "lax", path: "\/"/);
  });
});
