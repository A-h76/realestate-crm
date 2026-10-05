/**
 * Post-build CSP check (SEC-010). Run it against a running PRODUCTION build (`npm run build && npm start`):
 *
 *   BASE_URL=http://localhost:3000 npx tsx scripts/check-csp.ts
 *   E2E_EMAIL=... E2E_PASSWORD=... npx tsx scripts/check-csp.ts     # also checks signed-in pages
 *   CHROME_PATH=/path/to/chrome ...                                 # override browser discovery
 *
 * 1. HTTP: each page has one CSP, no 'unsafe-inline' in script-src, every <script> carries the response's nonce,
 *    there are no inline on*= handlers, and the nonce differs between requests.
 * 2. Browser (needs Chrome/Edge, headless): loads each page with the real policy enforced, fails on any CSP
 *    violation or uncaught error, and confirms React hydrated (the page is interactive, not just blocked HTML).
 *
 * Exits non-zero on any failure. Never prints credentials or cookie values.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const PUBLIC_PAGES = ["/login"];
const APP_PAGES = ["/dashboard", "/leads", "/pipeline", "/settings", "/conversations", "/automations"];
const failures: string[] = [];
const fail = (msg: string) => failures.push(msg);

function cookiesFrom(res: Response): Map<string, string> {
  const jar = new Map<string, string>();
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  return jar;
}

async function signIn(): Promise<Map<string, string> | null> {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD ?? process.env.DEMO_SEED_PASSWORD;
  if (!email || !password) return null;
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  const jar = cookiesFrom(csrfRes);
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") },
    body: new URLSearchParams({ csrfToken, email, password, callbackUrl: `${BASE}/dashboard`, json: "true" }),
    redirect: "manual",
  });
  for (const [k, v] of cookiesFrom(res)) jar.set(k, v);
  const session = await fetch(`${BASE}/api/auth/session`, { headers: { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } }).then((r) => r.json());
  if (!session?.user) throw new Error("Sign-in failed: check E2E_EMAIL / E2E_PASSWORD");
  return jar;
}

async function httpCheck(path: string, jar: Map<string, string> | null) {
  const cookie = jar ? [...jar].map(([k, v]) => `${k}=${v}`).join("; ") : "";
  const get = async () => {
    const res = await fetch(`${BASE}${path}`, { headers: cookie ? { Cookie: cookie } : {}, redirect: "manual" });
    return { res, html: await res.text() };
  };
  const [a, b] = [await get(), await get()];
  if (a.res.status !== 200) return fail(`${path}: HTTP ${a.res.status} (expected 200)`);
  const csp = a.res.headers.get("content-security-policy") ?? "";
  const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
  if (!nonce) return fail(`${path}: no nonce in Content-Security-Policy`);
  const script = csp.split("; ").find((d) => d.startsWith("script-src")) ?? "";
  if (script.includes("'unsafe-inline'")) fail(`${path}: script-src allows 'unsafe-inline'`);
  const tags = a.html.match(/<script\b[^>]*>/gi) ?? [];
  if (tags.length === 0) fail(`${path}: no <script> tags found (page is not hydrating)`);
  const missing = tags.filter((t) => !t.includes(`nonce="${nonce}"`));
  if (missing.length) fail(`${path}: ${missing.length}/${tags.length} <script> tags lack the response nonce`);
  if (/\son[a-z]+\s*=\s*["']/i.test(a.html.replace(/<script[\s\S]*?<\/script>/gi, ""))) fail(`${path}: inline event handler attribute present`);
  const nonce2 = /'nonce-([^']+)'/.exec(b.res.headers.get("content-security-policy") ?? "")?.[1];
  if (nonce2 === nonce) fail(`${path}: nonce repeated across requests`);
  console.log(`http  ${path}: ${tags.length} script tags, all nonced`);
}

function findBrowser(): string | null {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  return candidates.find((c): c is string => Boolean(c) && existsSync(c as string)) ?? null;
}

type Cdp = { send: (method: string, params?: object) => Promise<Record<string, unknown>>; on: (cb: (m: { method: string; params: Record<string, unknown> }) => void) => void; close: () => void };

async function connect(wsUrl: string): Promise<Cdp> {
  const ws = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("CDP connection failed"));
  });
  let id = 0;
  const pending = new Map<number, (v: Record<string, unknown>) => void>();
  const listeners: Array<(m: { method: string; params: Record<string, unknown> }) => void> = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id && pending.has(msg.id)) pending.get(msg.id)!(msg.error ? { error: msg.error.message } : (msg.result ?? {}));
    else if (msg.method) listeners.forEach((l) => l(msg));
  };
  return {
    send: (method, params = {}) => new Promise((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })); }),
    on: (cb) => listeners.push(cb),
    close: () => ws.close(),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function browserCheck(pages: string[], jar: Map<string, string> | null) {
  const exe = findBrowser();
  if (!exe) return console.log("browser: SKIPPED (no Chrome/Edge found; set CHROME_PATH). HTTP checks do not prove hydration.");
  const dir = mkdtempSync(join(tmpdir(), "csp-check-"));
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc: ChildProcess = spawn(exe, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
  try {
    let target: { webSocketDebuggerUrl: string } | undefined;
    for (let i = 0; i < 50 && !target; i++) {
      await sleep(200);
      try {
        const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;
        target = list.find((t) => t.type === "page");
      } catch { /* browser still starting */ }
    }
    if (!target) return fail("browser: could not start a headless browser");
    const cdp = await connect(target.webSocketDebuggerUrl);
    let problems: string[] = [];
    cdp.on((m) => {
      const text = JSON.stringify(m.params).slice(0, 400);
      if (m.method === "Log.entryAdded" && /Content Security Policy|Refused to/i.test(text)) problems.push(`CSP: ${text}`);
      if (m.method === "Runtime.exceptionThrown") problems.push(`uncaught: ${text}`);
      if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error") && /Content Security Policy|Refused to/i.test(text)) problems.push(`CSP: ${text}`);
    });
    await cdp.send("Log.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    for (const [name, value] of jar ?? []) {
      const r = await cdp.send("Network.setCookie", { name, value, url: BASE, path: "/", ...(/^__(Host|Secure)-/.test(name) ? { secure: true } : {}) });
      if (r.error || r.success === false) return fail(`browser: could not set the ${name} cookie (${String(r.error ?? "rejected")})`);
    }
    for (const path of pages) {
      problems = [];
      await cdp.send("Page.navigate", { url: `${BASE}${path}` });
      await sleep(4000);
      const evalRes = (await cdp.send("Runtime.evaluate", {
        expression: `(() => { const els = document.querySelectorAll('body *'); for (const e of els) { if (Object.keys(e).some(k => k.startsWith('__reactFiber') || k.startsWith('__reactProps'))) return location.pathname; } return null; })()`,
        returnByValue: true,
      })) as { result?: { value?: string | null } };
      const hydratedAt = evalRes.result?.value;
      if (!hydratedAt) problems.push("page did not hydrate (no React fibers on the DOM)");
      else if (!hydratedAt.startsWith(path.split("?")[0])) problems.push(`redirected to ${hydratedAt} (not signed in?)`);
      if (problems.length) fail(`browser ${path}: ${problems.join(" | ")}`);
      else console.log(`browser ${path}: hydrated, no CSP violations`);
    }
    cdp.close();
  } finally {
    proc.kill();
    await sleep(500);
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* temp profile still locked; harmless */ }
  }
}

async function main() {
  const jar = await signIn();
  const pages = jar ? [...PUBLIC_PAGES, ...APP_PAGES] : PUBLIC_PAGES;
  if (!jar) console.log("not signed in (no E2E_EMAIL / E2E_PASSWORD): checking public pages only");
  for (const p of PUBLIC_PAGES) await httpCheck(p, null);
  if (jar) for (const p of APP_PAGES) await httpCheck(p, jar);
  await browserCheck(pages, jar);
  if (failures.length) {
    console.error(`\nFAILED (${failures.length}):\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nCSP check passed");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
