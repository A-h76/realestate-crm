import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";

/**
 * TEST-005: this file used to be named a "security" test while only asserting that a few strings were absent from a
 * few files. It is repository hygiene, and is now honest about that: it checks that no committed file carries a
 * credential. It does NOT test runtime behaviour (authentication, authorization, tenant isolation and webhook checks
 * are covered by the HTTP-level tests in this directory), and it cannot find a secret in git history or in an
 * environment variable.
 */
const root = join(import.meta.dirname, "../..");
const read = (relative: string) => readFileSync(join(root, relative), "utf8");

/** Patterns for credentials that must never be committed. Each is specific enough to avoid matching ordinary text. */
export const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { name: "OpenAI-style API key", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/ },
  { name: "Meta Graph access token", re: /\bEAA[A-Za-z0-9]{60,}\b/ },
  { name: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: "Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{20,}\b/ },
  { name: "Upstash/REST token assignment", re: /UPSTASH_REDIS_REST_TOKEN\s*=\s*["']?[A-Za-z0-9=_-]{30,}/ },
  {
    name: "database URL with a real host and password",
    // user:password@host where host is not localhost / 127.0.0.1 / a placeholder
    re: /postgres(?:ql)?:\/\/[^:\s/@"']+:(?!postgres\b|password\b|PASSWORD\b|\$|\{|<|changeme|\*+)[^@\s"']{6,}@(?!(?:localhost|127\.0\.0\.1|db|postgres|host|HOST)(?:[:/]|$)|\$|\{|<)[A-Za-z0-9.-]+/,
  },
];

export function findSecrets(text: string): string[] {
  return SECRET_PATTERNS.filter(({ re }) => re.test(text)).map(({ name }) => name);
}

function trackedFiles(): string[] | null {
  try {
    return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
      .split("\0")
      .filter(Boolean);
  } catch {
    return null; // not a git checkout (e.g. a source tarball)
  }
}

const SKIP = /(^|\/)(package-lock\.json|node_modules\/)|\.(png|jpe?g|gif|webp|ico|woff2?|pdf)$|^tests\/security\/leakage\.test\.ts$/;

describe("Repository hygiene: no committed credentials", () => {
  it("the secret scanner flags real-looking credentials and ignores placeholders (so a pass means something)", () => {
    const real: Array<[string, string]> = [
      ["private key block", "-----BEGIN RSA PRIVATE KEY-----\nMIIE"],
      ["OpenAI-style API key", `key = "sk-${"a1B2c3D4".repeat(5)}"`],
      ["Meta Graph access token", `token: EAA${"x9Y8".repeat(20)}`],
      ["AWS access key id", "AKIAABCDEFGHIJKLMNOP"],
      ["GitHub token", `ghp_${"A1b2".repeat(10)}`],
      ["database URL with a real host and password", "postgresql://crm_admin:s3cretPassw0rd@db.example-prod.railway.internal:5432/crm"],
    ];
    for (const [name, sample] of real) assert.ok(findSecrets(sample).includes(name), `should flag: ${name}`);

    const harmless = [
      'DATABASE_URL="postgresql://postgres:postgres@localhost:5432/leadtosale_crm?schema=public"',
      "postgresql://user:password@host:5432/db",
      "postgres://${USER}:${PASSWORD}@${HOST}/db",
      "# WHATSAPP_ACCESS_TOKEN=",
      "AUTH_SECRET=generate-a-secure-secret-at-least-32-characters",
      "sk-short",
    ];
    for (const sample of harmless) assert.deepEqual(findSecrets(sample), [], `should not flag: ${sample}`);
  });

  it("no tracked source, config, doc or test file contains a credential", () => {
    const files = trackedFiles();
    if (!files) return; // reported as passing only where git is available; CI always has it
    assert.ok(files.length > 50, "expected a populated repository");
    const offenders: string[] = [];
    for (const file of files) {
      if (SKIP.test(file)) continue;
      let text: string;
      try {
        text = read(file);
      } catch {
        continue; // deleted in the working tree
      }
      for (const name of findSecrets(text)) offenders.push(`${file}: ${name}`); // names the file and kind, never the value
    }
    assert.deepEqual(offenders, []);
  });

  it("demo passwords are not shipped in client code, docs, env template or seed source", () => {
    for (const file of ["src/app/login/login-form.tsx", "README.md", "PRODUCT.md", ".env.example", "prisma/seed-data.ts"]) {
      assert.equal(read(file).includes("demo1234"), false, file);
    }
    assert.equal(read("src/app/login/login-form.tsx").includes("dana@synaslabs.demo"), false);
    const seed = read("prisma/seed-data.ts");
    assert.equal(seed.includes("DEMO_PASSWORD"), false);
    assert.ok(seed.includes("DEMO_SEED_PASSWORD"), "the seed must take its password from the environment");
  });

  it(".env files other than the template are not tracked", () => {
    const files = trackedFiles();
    if (!files) return;
    const tracked = files.filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !/\.env\.example$/.test(f));
    assert.deepEqual(tracked, []);
  });
});
