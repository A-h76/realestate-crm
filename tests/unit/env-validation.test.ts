import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertValidEnv, validateEnv } from "../../src/lib/env";

/** OPS-003: configuration rules. Each case passes an explicit env object; process.env is never touched. */
const GOOD_SECRET = "k3Jd8sLq0vXz91mNpRt5uYw2aBcD4eFg";
const prod = (over: Record<string, string | undefined> = {}) =>
  ({ NODE_ENV: "production", DATABASE_URL: "postgresql://u:p@db.example.com:5432/crm", AUTH_SECRET: GOOD_SECRET, AUTH_URL: "https://crm.example.com", ...over }) as NodeJS.ProcessEnv;
const keys = (xs: Array<{ key: string }>) => xs.map((x) => x.key);

describe("validateEnv: errors (stop a production start)", () => {
  it("a complete production configuration has no errors and no warnings", () => {
    const r = validateEnv(prod());
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.warnings, []);
    assert.equal(r.mode, "production");
  });

  it("DATABASE_URL: required, and must be a postgres URL", () => {
    assert.deepEqual(keys(validateEnv(prod({ DATABASE_URL: undefined })).errors), ["DATABASE_URL"]);
    assert.deepEqual(keys(validateEnv(prod({ DATABASE_URL: "mysql://u:p@h/db" })).errors), ["DATABASE_URL"]);
    assert.deepEqual(keys(validateEnv(prod({ DATABASE_URL: "not a url" })).errors), ["DATABASE_URL"]);
  });

  it("AUTH_SECRET in production: missing, short, and placeholder values are all rejected", () => {
    assert.deepEqual(keys(validateEnv(prod({ AUTH_SECRET: undefined })).errors), ["AUTH_SECRET"]);
    assert.deepEqual(keys(validateEnv(prod({ AUTH_SECRET: "short" })).errors), ["AUTH_SECRET"]);
    assert.deepEqual(keys(validateEnv(prod({ AUTH_SECRET: "generate-a-secure-secret-at-least-32-characters" })).errors), ["AUTH_SECRET"]);
    assert.deepEqual(keys(validateEnv(prod({ AUTH_SECRET: "ci-only-secret-at-least-32-characters-long" })).errors), ["AUTH_SECRET"]);
  });

  it("AUTH_SECRET outside production only has to exist", () => {
    assert.deepEqual(validateEnv({ NODE_ENV: "development", DATABASE_URL: "postgresql://u:p@localhost/db", AUTH_SECRET: "dev" } as NodeJS.ProcessEnv).errors, []);
    assert.deepEqual(keys(validateEnv({ NODE_ENV: "development", DATABASE_URL: "postgresql://u:p@localhost/db" } as NodeJS.ProcessEnv).errors), ["AUTH_SECRET"]);
  });

  it("AUTH_URL: required in production (NEXTAUTH_URL also accepted), must be http(s)", () => {
    assert.deepEqual(keys(validateEnv(prod({ AUTH_URL: undefined })).errors), ["AUTH_URL"]);
    assert.deepEqual(validateEnv(prod({ AUTH_URL: undefined, NEXTAUTH_URL: "https://crm.example.com" })).errors, []);
    assert.deepEqual(keys(validateEnv(prod({ AUTH_URL: "ftp://x" })).errors), ["AUTH_URL"]);
  });

  it("reports every problem at once", () => {
    assert.deepEqual(keys(validateEnv(prod({ DATABASE_URL: undefined, AUTH_SECRET: "x", AUTH_URL: undefined })).errors).sort(), ["AUTH_SECRET", "AUTH_URL", "DATABASE_URL"]);
  });
});

describe("validateEnv: warnings (logged, never fatal)", () => {
  it("http AUTH_URL in production, DISABLE_HSTS, and a malformed DEMO_MODE", () => {
    assert.deepEqual(keys(validateEnv(prod({ AUTH_URL: "http://crm.example.com" })).warnings), ["AUTH_URL"]);
    assert.deepEqual(keys(validateEnv(prod({ DISABLE_HSTS: "true" })).warnings), ["DISABLE_HSTS"]);
    assert.deepEqual(keys(validateEnv(prod({ DEMO_MODE: "yes" })).warnings), ["DEMO_MODE"]);
  });

  it("DEMO_MODE=true in a production build is reported as demo mode with a warning", () => {
    const r = validateEnv(prod({ DEMO_MODE: "true" }));
    assert.equal(r.mode, "demo");
    assert.deepEqual(keys(r.warnings), ["DEMO_MODE"]);
    assert.deepEqual(r.errors, []);
  });

  it("live WhatsApp selected: each missing sending / receiving setting is named, and none blocks start", () => {
    const r = validateEnv(prod({ WHATSAPP_BUSINESS_ENABLED: "true" }));
    assert.deepEqual(r.errors, []);
    assert.deepEqual(keys(r.warnings).sort(), ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_VERIFY_TOKEN", "WHATSAPP_WORKSPACE_ID"]);
    const complete = validateEnv(prod({ WHATSAPP_BUSINESS_ENABLED: "true", WHATSAPP_ACCESS_TOKEN: "a", WHATSAPP_PHONE_NUMBER_ID: "b", WHATSAPP_APP_SECRET: "c", WHATSAPP_VERIFY_TOKEN: "d", WHATSAPP_WORKSPACE_ID: "e" }));
    assert.deepEqual(complete.warnings, []);
  });

  it("WhatsApp settings are ignored while live mode is not selected", () => {
    assert.deepEqual(validateEnv(prod({ WHATSAPP_BUSINESS_ENABLED: "false" })).warnings, []);
  });

  it("Upstash must be configured as a pair; the Graph version must look like v21.0", () => {
    assert.deepEqual(keys(validateEnv(prod({ UPSTASH_REDIS_REST_URL: "https://x.upstash.io" })).warnings), ["UPSTASH_REDIS_REST_URL"]);
    assert.deepEqual(validateEnv(prod({ UPSTASH_REDIS_REST_URL: "https://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t" })).warnings, []);
    assert.deepEqual(keys(validateEnv(prod({ WHATSAPP_GRAPH_API_VERSION: "latest" })).warnings), ["WHATSAPP_GRAPH_API_VERSION"]);
  });
});

describe("secrets never appear in the report or the thrown error", () => {
  it("messages name the variable and the rule, not the value", () => {
    const env = prod({ AUTH_SECRET: "tooshort-SENTINEL", DATABASE_URL: "mysql://admin:SENTINEL-PW@h/db", UPSTASH_REDIS_REST_TOKEN: "SENTINEL-TOKEN" });
    const report = JSON.stringify(validateEnv(env));
    assert.ok(!report.includes("SENTINEL"));
    assert.throws(
      () => assertValidEnv(env),
      (e: Error) => /AUTH_SECRET/.test(e.message) && /DATABASE_URL/.test(e.message) && !e.message.includes("SENTINEL"),
    );
  });

  it("assertValidEnv returns the report when valid", () => {
    assert.equal(assertValidEnv(prod()).mode, "production");
  });
});
