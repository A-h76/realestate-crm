import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "../..");

function read(relative: string) {
  return readFileSync(join(root, relative), "utf8");
}

describe("Credential and secret leakage", () => {
  it("does not ship demo passwords in client login code", () => {
    const login = read("src/app/login/login-form.tsx");
    assert.equal(login.includes("demo1234"), false);
    assert.equal(login.includes("ahmed@synaslabs.demo"), false);
  });

  it("does not document demo passwords in README or PRODUCT.md", () => {
    assert.equal(read("README.md").includes("demo1234"), false);
    assert.equal(read("PRODUCT.md").includes("demo1234"), false);
    assert.equal(read(".env.example").includes("demo1234"), false);
  });

  it("does not hardcode a demo password in seed source", () => {
    const seed = read("prisma/seed-data.ts");
    assert.equal(seed.includes("demo1234"), false);
    assert.equal(seed.includes("DEMO_PASSWORD"), false);
    assert.ok(seed.includes("DEMO_SEED_PASSWORD"));
  });
});
