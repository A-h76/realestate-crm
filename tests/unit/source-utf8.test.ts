import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// A stray Latin-1 byte (e.g. 0xB7 for "·") passes tsc but makes Next/SWC refuse to compile the page (500 at runtime).
function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(tsx?|css)$/.test(e.name)) yield p;
  }
}

test("every source file under src/ is valid UTF-8", () => {
  const dec = new TextDecoder("utf-8", { fatal: true });
  const bad: string[] = [];
  for (const f of walk("src")) {
    try {
      dec.decode(readFileSync(f));
    } catch {
      bad.push(f);
    }
  }
  assert.deepEqual(bad, []);
});
