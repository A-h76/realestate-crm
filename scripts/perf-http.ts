/**
 * Authenticated HTTP performance harness.
 *
 * Starts a local `next start` instance (unless PERF_HTTP_URL is set),
 * logs in with the demo owner account, and measures real HTTP durations.
 * Does not bypass auth, RBAC, or rate limits.
 *
 * Usage: npx tsx scripts/perf-http.ts
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { classifyHttp, durationStats, type DurationStats } from "./perf-stats";

type PerfSummary = {
  db?: number;
  dbQueries?: number;
  extMs?: number;
  ext?: number;
  auth?: number;
  authz?: number;
  parse?: number;
  auto?: number;
};

type Sample = {
  httpMs: number;
  ttfbMs: number;
  status: number;
  requestId: string | null;
  bytes: number;
  text: string;
  summary: PerfSummary;
};

type EndpointReport = {
  method: string;
  path: string;
  samples: number;
  stats: DurationStats;
  class: ReturnType<typeof classifyHttp>;
  status: number[];
  dbMean?: number;
  dbQueriesMean?: number;
  extMsMean?: number;
  authMean?: number;
  authzMean?: number;
  parseMean?: number;
  autoMean?: number;
  coldHttpMs?: number;
  coldTtfbMs?: number;
  ttfbMean?: number;
  requestIds: string[];
};

function loadDotEnv() {
  const file = resolve(process.cwd(), ".env");
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = value;
  }
}

function parseSummary(header: string | null): PerfSummary {
  if (!header) return {};
  const out: PerfSummary = {};
  for (const part of header.split(";")) {
    const [key, raw] = part.split("=");
    const value = Number(raw);
    if (!key || Number.isNaN(value)) continue;
    if (key === "db") out.db = value;
    else if (key === "dbQueries") out.dbQueries = value;
    else if (key === "extMs") out.extMs = value;
    else if (key === "ext") out.ext = value;
    else if (key === "auth") out.auth = value;
    else if (key === "authz") out.authz = value;
    else if (key === "parse") out.parse = value;
    else if (key === "auto") out.auto = value;
  }
  return out;
}

function mean(values: Array<number | undefined>): number | undefined {
  const nums = values.filter((value): value is number => typeof value === "number");
  if (nums.length === 0) return undefined;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function setCookies(res: Response): string[] {
  if (typeof res.headers.getSetCookie === "function") return res.headers.getSetCookie();
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
}

function cookieHeaderFromJar(jar: string[]): string {
  return jar
    .map((cookie) => {
      const part = cookie.split(";")[0];
      const eq = part.indexOf("=");
      if (eq < 0) return part;
      const name = part.slice(0, eq);
      let value = part.slice(eq + 1);
      try {
        value = decodeURIComponent(value);
      } catch {
        /* keep raw */
      }
      return `${name}=${value}`;
    })
    .join("; ");
}

function mergeCookies(existing: string[], incoming: string[]) {
  const map = new Map<string, string>();
  for (const list of [existing, incoming]) {
    for (const cookie of list) {
      const part = cookie.split(";")[0];
      const eq = part.indexOf("=");
      if (eq > 0) map.set(part.slice(0, eq), part);
    }
  }
  return [...map.values()];
}

function csvRows(n: number, prefix: string) {
  const header = "firstName,email,phone,source";
  const rows = Array.from(
    { length: n },
    (_, i) => `${prefix}${i},${prefix}${i}@perf.invalid,+92300888${String(i).padStart(4, "0")},WALK_IN`,
  );
  return [header, ...rows].join("\n");
}

function round(value: number | undefined): number | undefined {
  if (value == null) return undefined;
  return Math.round(value * 10) / 10;
}

function compactSample(sample: Sample) {
  return {
    httpMs: round(sample.httpMs),
    ttfbMs: round(sample.ttfbMs),
    status: sample.status,
    requestId: sample.requestId,
    bytes: sample.bytes,
    summary: sample.summary,
  };
}

const prisma = new PrismaClient();
const PORT = process.env.PERF_HTTP_PORT ?? "3010";
const BASE = process.env.PERF_HTTP_URL ?? `http://127.0.0.1:${PORT}`;
const WARMUP = 3;
const RUNS = 10;

let cookieHeader = "";
const reports: EndpointReport[] = [];
const extras: Record<string, unknown> = {};

async function timedFetch(
  method: string,
  path: string,
  init?: { body?: string; contentType?: string; extraHeaders?: Record<string, string> },
): Promise<Sample> {
  const started = performance.now();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Cookie: cookieHeader,
      ...(init?.body ? { "Content-Type": init.contentType ?? "application/json" } : {}),
      ...(init?.extraHeaders ?? {}),
    },
    body: init?.body,
    redirect: "manual",
    cache: "no-store",
  });
  const ttfbMs = performance.now() - started;
  const buf = Buffer.from(await res.arrayBuffer());
  const httpMs = performance.now() - started;
  const text = buf.toString("utf8");
  const setCookieHeader = setCookies(res);
  if (setCookieHeader.length) {
    cookieHeader = mergeCookies(
      cookieHeader ? cookieHeader.split("; ").filter(Boolean) : [],
      setCookieHeader,
    ).join("; ");
  }
  return {
    httpMs,
    ttfbMs,
    status: res.status,
    requestId: res.headers.get("x-request-id"),
    bytes: buf.byteLength,
    text,
    summary: parseSummary(res.headers.get("x-perf-summary")),
  };
}

function toReport(method: string, path: string, all: Sample[], cold?: Sample): EndpointReport {
  const measured = all.slice(WARMUP);
  const stats = durationStats(measured.map((sample) => sample.httpMs));
  return {
    method,
    path,
    samples: measured.length,
    stats: {
      ...stats,
      min: round(stats.min)!,
      max: round(stats.max)!,
      mean: round(stats.mean)!,
      median: round(stats.median)!,
      p95: round(stats.p95)!,
    },
    class: classifyHttp(stats.p95),
    status: [...new Set(measured.map((sample) => sample.status))],
    dbMean: round(mean(measured.map((sample) => sample.summary.db))),
    dbQueriesMean: round(mean(measured.map((sample) => sample.summary.dbQueries))),
    extMsMean: round(mean(measured.map((sample) => sample.summary.extMs))),
    authMean: round(mean(measured.map((sample) => sample.summary.auth))),
    authzMean: round(mean(measured.map((sample) => sample.summary.authz))),
    parseMean: round(mean(measured.map((sample) => sample.summary.parse))),
    autoMean: round(mean(measured.map((sample) => sample.summary.auto))),
    coldHttpMs: cold ? round(cold.httpMs) : round(all[0]?.httpMs),
    coldTtfbMs: cold ? round(cold.ttfbMs) : round(all[0]?.ttfbMs),
    ttfbMean: round(mean(measured.map((sample) => sample.ttfbMs))),
    requestIds: measured.map((sample) => sample.requestId).filter((id): id is string => Boolean(id)).slice(0, 3),
  };
}

async function measureEndpoint(
  method: string,
  path: string,
  options?: {
    warmup?: number;
    runs?: number;
    factory?: () => { body?: string; contentType?: string; extraHeaders?: Record<string, string> };
    label?: string;
  },
): Promise<EndpointReport> {
  const warmup = options?.warmup ?? WARMUP;
  const runs = options?.runs ?? RUNS;
  const all: Sample[] = [];
  let failStreak = 0;
  for (let i = 0; i < warmup + runs; i++) {
    const init = options?.factory?.();
    const sample = await timedFetch(method, path, init);
    all.push(sample);
    if (sample.status >= 500) failStreak += 1;
    else failStreak = 0;
    if (failStreak >= 5) {
      throw new Error(`Aborting ${method} ${path}: five consecutive HTTP ${sample.status} responses`);
    }
  }
  const report = toReport(method, options?.label ?? path, all);
  reports.push(report);
  console.info(
    `[HTTP] ${method} ${path} n=${report.samples} min=${report.stats.min} median=${report.stats.median} mean=${report.stats.mean} p95=${report.stats.p95} max=${report.stats.max} class=${report.class} db=${report.dbMean ?? "n/a"} queries=${report.dbQueriesMean ?? "n/a"}`,
  );
  return report;
}

async function login(email: string, password: string) {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  const csrfJson = (await csrfRes.json()) as { csrfToken: string };
  let jar = mergeCookies([], setCookies(csrfRes));
  console.info(
    `[HTTP] csrf status=${csrfRes.status} cookieNames=${jar.map((c) => c.split("=")[0]).join(",") || "none"} token=${csrfJson.csrfToken ? "present" : "missing"}`,
  );
  const body = new URLSearchParams({
    csrfToken: csrfJson.csrfToken,
    email,
    password,
    callbackUrl: `${BASE}/dashboard`,
    json: "true",
  });
  const started = performance.now();
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieHeaderFromJar(jar),
      Origin: BASE,
      Referer: `${BASE}/login`,
    },
    body,
    redirect: "manual",
  });
  const loginMs = performance.now() - started;
  jar = mergeCookies(jar, setCookies(res));
  cookieHeader = cookieHeaderFromJar(jar);
  const session = await fetch(`${BASE}/api/auth/session`, {
    headers: { Cookie: cookieHeader },
  }).then((r) => r.json());
  if (!session?.user) {
    throw new Error(`Login failed status=${res.status} cookies=${jar.length}`);
  }
  extras.loginHttpMs = round(loginMs);
  extras.loginStatus = res.status;
  extras.loginRequestId = res.headers.get("x-request-id");
  extras.loginSummary = parseSummary(res.headers.get("x-perf-summary"));
  console.info(`[HTTP] LOGIN duration=${round(loginMs)}ms status=${res.status} user=${session.user.email}`);
  return session.user as { id: string; email: string; workspaceId: string };
}

async function waitForServer(url: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/login`, { redirect: "manual" });
      if (res.status > 0) return;
    } catch (error) {
      last = error instanceof Error ? error.message : "error";
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server did not start: ${last}`);
}

function startServer(): ChildProcess {
  const env = {
    ...process.env,
    PORT,
    PERF_HTTP_HEADERS: "true",
    AUTH_URL: BASE,
    NEXTAUTH_URL: BASE,
  };
  const child = spawn("npx", ["next", "start", "-p", PORT], {
    cwd: process.cwd(),
    env,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (buf) => {
    const text = String(buf);
    if (text.includes("[PERF]") || text.includes("Ready") || text.includes("started")) {
      process.stdout.write(text);
    }
  });
  child.stderr?.on("data", (buf) => process.stderr.write(String(buf)));
  return child;
}

function stopServer(child: ChildProcess | null) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { shell: true, stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

async function ensureDemoHarnessAccount(password: string) {
  const workspace = await prisma.workspace.findFirst({
    where: { slug: "synas-realty-demo", isDemo: true, deletedAt: null },
  });
  if (!workspace) {
    throw new Error("Demo workspace synas-realty-demo not found. Seed the local demo database first.");
  }
  const email = `perf.http.${Date.now()}@synaslabs.local`;
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      email,
      name: "Perf HTTP Harness",
      passwordHash,
    },
  });
  await prisma.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: user.id, role: "OWNER" },
  });
  return { email, userId: user.id, workspaceId: workspace.id };
}

function writeResults() {
  const dest = resolve(process.cwd(), "scripts/perf-http-results.json");
  const out = {
    at: new Date().toISOString(),
    base: BASE,
    warmup: WARMUP,
    runs: RUNS,
    datasetNote: "Baseline GETs used the demo workspace; volume used an isolated workspace that was deleted.",
    unauthenticatedLeadsStatus: extras.unauthenticatedLeadsStatus,
    login: {
      httpMs: extras.loginHttpMs,
      status: extras.loginStatus,
      summary: extras.loginSummary,
    },
    dashboard: {
      cold: extras.dashboardCold,
      warm: extras.dashboardWarm,
      weatherFail: extras.dashboardWeatherFail,
      apiNoWeather: extras.dashboardApiNoWeather,
    },
    csv: extras.csv,
    volume: extras.volume,
    volumeSeedMs: extras.volumeSeedMs,
    volumeIsolation: extras.volumeIsolation,
    endpoints: reports,
  };
  writeFileSync(dest, JSON.stringify(out, null, 2));
  console.info(`[HTTP] wrote ${dest}`);
}

async function cleanupHarnessLeads() {
  await prisma.lead.deleteMany({
    where: {
      OR: [
        { firstName: { in: ["PerfHttp", "PerfHttpKeep"] } },
        { firstName: { startsWith: "Csv" } },
        { email: { endsWith: "@perf.invalid" } },
      ],
    },
  });
}

async function seedVolumeLeads(workspaceId: string, ownerId: string, count: number) {
  const batch = 200;
  let created = 0;
  while (created < count) {
    const n = Math.min(batch, count - created);
    await prisma.lead.createMany({
      data: Array.from({ length: n }, (_, i) => ({
        workspaceId,
        ownerId,
        firstName: `Vol${created + i}`,
        lastName: "Scale",
        email: `vol${created + i}.${workspaceId.slice(-6)}@perf.invalid`,
        source: "WALK_IN" as const,
        stage: "NEW" as const,
      })),
    });
    created += n;
  }
}

async function main() {
  loadDotEnv();
  const password =
    process.env.DEMO_SEED_PASSWORD ?? process.env.E2E_PASSWORD ?? randomBytes(18).toString("base64url");
  let email = process.env.E2E_EMAIL;
  let harnessUserId: string | undefined;
  if (!email) {
    const account = await ensureDemoHarnessAccount(password);
    email = account.email;
    harnessUserId = account.userId;
  } else if (!process.env.DEMO_SEED_PASSWORD && !process.env.E2E_PASSWORD) {
    throw new Error("Set DEMO_SEED_PASSWORD or E2E_PASSWORD when E2E_EMAIL is provided.");
  }

  let child: ChildProcess | null = null;
  const startedServer = !process.env.PERF_HTTP_URL;
  try {
    if (startedServer) {
      console.info(`[HTTP] starting next start on ${BASE}`);
      child = startServer();
      await waitForServer(BASE, 60_000);
    }

    await cleanupHarnessLeads();

    const unauth = await fetch(`${BASE}/api/leads`, { redirect: "manual" });
    extras.unauthenticatedLeadsStatus = unauth.status;
    extras.unauthenticatedLeadsLocation = unauth.headers.get("location");
    console.info(`[HTTP] GET /api/leads unauthenticated status=${unauth.status}`);
    if (unauth.status !== 401 && unauth.status !== 307 && unauth.status !== 303) {
      throw new Error(`Expected unauthenticated 401/redirect, got ${unauth.status}`);
    }

    const user = await login(email, password);
    extras.authenticatedEmail = user.email;
    extras.authenticatedWorkspaceId = user.workspaceId;

    const probe = await timedFetch("GET", "/api/leads?pageSize=1");
    extras.firstLeadsStatus = probe.status;
    if (probe.status !== 200) {
      throw new Error(`Authenticated GET /api/leads failed status=${probe.status} body=${probe.text.slice(0, 300)}`);
    }
    if (probe.summary.dbQueries == null) {
      throw new Error(
        "x-perf-summary missing. Rebuild the app and run this harness so PERF_HTTP_HEADERS=true is set on next start.",
      );
    }
    const bootstrapJson = JSON.parse(probe.text) as { items?: Array<{ id: string }> };
    const existingLeadId = bootstrapJson.items?.[0]?.id;
    if (!existingLeadId) throw new Error("No lead available for mutation measurements");

    const stagesRes = await fetch(`${BASE}/api/pipeline/stages`, { headers: { Cookie: cookieHeader } });
    const stagesJson = (await stagesRes.json()) as { items?: Array<{ id: string; slug: string }> } | Array<{ id: string; slug: string }>;
    const stages = Array.isArray(stagesJson) ? stagesJson : (stagesJson.items ?? []);
    const openStage = stages.find((s) => s.slug !== "won" && s.slug !== "lost") ?? stages[0];

    extras.dashboardCold = compactSample(await timedFetch("GET", "/dashboard"));
    extras.dashboardWarm = [];
    for (let i = 0; i < 5; i++) {
      (extras.dashboardWarm as unknown[]).push(compactSample(await timedFetch("GET", "/dashboard")));
    }
    extras.dashboardWeatherFail = compactSample(
      await timedFetch("GET", "/dashboard", {
        extraHeaders: { "x-perf-weather": "fail" },
      }),
    );
    extras.dashboardApiNoWeather = compactSample(await timedFetch("GET", "/api/dashboard"));
    const dashCold = extras.dashboardCold as { httpMs?: number; ttfbMs?: number; status?: number };
    const dashWarm = extras.dashboardWarm as Array<{ httpMs?: number; ttfbMs?: number }>;
    const dashFail = extras.dashboardWeatherFail as { httpMs?: number; ttfbMs?: number; status?: number };
    const dashApi = extras.dashboardApiNoWeather as { httpMs?: number; ttfbMs?: number };
    console.info(
      `[HTTP] dashboard cold http=${dashCold.httpMs} ttfb=${dashCold.ttfbMs} status=${dashCold.status}`,
    );
    console.info(
      `[HTTP] dashboard warm http=${dashWarm.map((s) => s.httpMs).join(",")} ttfb=${dashWarm.map((s) => s.ttfbMs).join(",")}`,
    );
    console.info(
      `[HTTP] dashboard weatherFail http=${dashFail.httpMs} ttfb=${dashFail.ttfbMs} status=${dashFail.status}`,
    );
    console.info(`[HTTP] dashboard apiNoWeather http=${dashApi.httpMs} ttfb=${dashApi.ttfbMs}`);

    await measureEndpoint("GET", "/api/leads?pageSize=20", { label: "/api/leads" });
    await measureEndpoint("GET", "/api/opportunities?pageSize=20", { label: "/api/opportunities" });
    await measureEndpoint("GET", "/api/properties?pageSize=20", { label: "/api/properties" });
    await measureEndpoint("GET", "/api/accounts?pageSize=20", { label: "/api/accounts" });
    await measureEndpoint("GET", "/api/contacts?pageSize=20", { label: "/api/contacts" });
    await measureEndpoint("GET", "/api/tasks?pageSize=20", { label: "/api/tasks" });
    await measureEndpoint("GET", "/api/activities?pageSize=20", { label: "/api/activities" });
    await measureEndpoint("GET", "/api/proposals?pageSize=20", { label: "/api/proposals" });
    await measureEndpoint("GET", "/api/notifications");
    await measureEndpoint("GET", "/api/dashboard");
    await measureEndpoint("GET", "/api/search?q=dha");
    await measureEndpoint("GET", "/api/insights?range=30d");
    await measureEndpoint("GET", "/api/audit?pageSize=20", { label: "/api/audit" });
    await measureEndpoint("GET", "/api/pipeline/stages");
    await measureEndpoint("GET", "/pipeline");
    await measureEndpoint("GET", "/leads");

    let createdLeadId = existingLeadId;
    await measureEndpoint("POST", "/api/leads", {
      factory: () => ({
        body: JSON.stringify({
          firstName: "PerfHttp",
          lastName: "Lead",
          source: "WALK_IN",
          notes: "authenticated-http-harness",
        }),
      }),
    });
    const keep = await timedFetch("POST", "/api/leads", {
      body: JSON.stringify({
        firstName: "PerfHttpKeep",
        lastName: "Lead",
        source: "WALK_IN",
      }),
    });
    try {
      const keepJson = JSON.parse(keep.text) as { id?: string };
      if (keepJson.id) createdLeadId = keepJson.id;
    } catch {
      createdLeadId = existingLeadId;
    }

    await measureEndpoint("PATCH", `/api/leads/${createdLeadId}`, {
      factory: () => ({ body: JSON.stringify({ notes: `perf-${Date.now()}` }) }),
    });

    const oppRes = await fetch(`${BASE}/api/opportunities?pageSize=1`, { headers: { Cookie: cookieHeader } });
    const oppJson = (await oppRes.json()) as { items?: Array<{ id: string }> };
    let oppId = oppJson.items?.[0]?.id;
    if (!oppId && openStage) {
      const made = await fetch(`${BASE}/api/opportunities`, {
        method: "POST",
        headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Perf HTTP opportunity",
          dealSide: "BUYER",
          value: 1000000,
          stageId: openStage.id,
          leadId: createdLeadId,
        }),
      });
      const madeJson = (await made.json()) as { id?: string };
      oppId = madeJson.id;
    }
    if (oppId) {
      await measureEndpoint("PATCH", `/api/opportunities/${oppId}`, {
        factory: () => ({ body: JSON.stringify({ notes: `perf-${Date.now()}` }) }),
      });
    }

    await measureEndpoint("POST", "/api/intelligence", {
      factory: () => ({
        body: JSON.stringify({ kind: "LEAD_ANALYSIS", leadId: createdLeadId }),
      }),
    });
    await measureEndpoint("POST", "/api/scoring", {
      factory: () => ({ body: JSON.stringify({ leadId: createdLeadId }) }),
    });
    await measureEndpoint("POST", "/api/proposals", {
      factory: () => ({
        body: JSON.stringify({
          value: 2500000,
          notes: "perf harness local only",
          leadId: createdLeadId,
        }),
      }),
    });
    const startAt = new Date(Date.now() + 86400000).toISOString();
    const endAt = new Date(Date.now() + 86400000 + 3600000).toISOString();
    await measureEndpoint("POST", "/api/calendar", {
      factory: () => ({
        body: JSON.stringify({
          title: "Perf harness local meeting",
          type: "MEETING",
          startAt,
          endAt,
          leadId: createdLeadId,
        }),
      }),
    });
    await measureEndpoint("POST", "/api/whatsapp/messages", {
      factory: () => ({
        body: JSON.stringify({
          conversationId: `lead:${createdLeadId}`,
          body: "Local demo message — not sent to WhatsApp.",
          leadId: createdLeadId,
        }),
      }),
    });

    extras.csv = {};
    for (const rows of [100, 250, 500] as const) {
      const runs = rows === 100 ? 3 : 1;
      const samples: Sample[] = [];
      for (let i = 0; i < runs; i++) {
        const sample = await timedFetch("POST", "/api/leads/csv", {
          body: csvRows(rows, `Csv${rows}r${i}`),
          contentType: "text/csv",
        });
        samples.push(sample);
        if (sample.status === 200) {
          try {
            const payload = JSON.parse(sample.text) as { ids?: string[] };
            if (payload.ids?.length) {
              await prisma.lead.deleteMany({ where: { id: { in: payload.ids } } });
            }
          } catch {
            /* keep going; cleanup is best-effort */
          }
        }
      }
      (extras.csv as Record<string, unknown>)[String(rows)] = {
        runs,
        statuses: samples.map((s) => s.status),
        httpMs: samples.map((s) => round(s.httpMs)),
        db: samples.map((s) => s.summary.db),
        parse: samples.map((s) => s.summary.parse),
        auto: samples.map((s) => s.summary.auto),
        queries: samples.map((s) => s.summary.dbQueries),
        class: samples.map((s) => classifyHttp(s.httpMs)),
        requestIds: samples.map((s) => s.requestId),
      };
      console.info(
        `[HTTP] POST /api/leads/csv rows=${rows} http=${samples.map((s) => Math.round(s.httpMs)).join(",")} status=${samples.map((s) => s.status).join(",")}`,
      );
    }

    const slug = `perf-http-${Date.now()}`;
    const hash = await bcrypt.hash(password, 10);
    const perfWs = await prisma.workspace.create({
      data: {
        name: "HTTP Perf Harness",
        slug,
        isDemo: true,
        members: {
          create: {
            role: "OWNER",
            user: {
              create: {
                email: `perf.http.${Date.now()}@synaslabs.local`,
                name: "Perf HTTP",
                passwordHash: hash,
              },
            },
          },
        },
      },
      include: { members: true },
    });
    const perfUserId = perfWs.members[0]?.userId;
    if (!perfUserId) throw new Error("perf user missing");
    extras.volume = {};
    try {
      const perfEmail = (await prisma.user.findUnique({ where: { id: perfUserId }, select: { email: true } }))!.email;
      await login(perfEmail, password);
      for (const count of [100, 500, 1000] as const) {
        await prisma.lead.deleteMany({ where: { workspaceId: perfWs.id, firstName: { startsWith: "Vol" } } });
        const seeded = performance.now();
        await seedVolumeLeads(perfWs.id, perfUserId, count);
        extras.volumeSeedMs = {
          ...(typeof extras.volumeSeedMs === "object" && extras.volumeSeedMs ? extras.volumeSeedMs : {}),
          [count]: round(performance.now() - seeded),
        };

        const keys = [
          ["/api/leads?pageSize=100", "GET"],
          ["/api/opportunities?pageSize=100", "GET"],
          ["/api/properties?pageSize=100", "GET"],
          ["/api/search?q=Vol", "GET"],
          ["/api/dashboard", "GET"],
          ["/api/insights?range=30d", "GET"],
          ["/api/pipeline/stages", "GET"],
          ["/pipeline", "GET"],
          ["/api/activities?pageSize=100", "GET"],
          ["/api/audit?pageSize=100", "GET"],
        ] as const;
        const volumeResult: Record<string, unknown> = { leadCount: count };
        for (const [path] of keys) {
          const samples: Sample[] = [];
          for (let i = 0; i < 4; i++) samples.push(await timedFetch("GET", path));
          const measured = samples.slice(1);
          const stats = durationStats(measured.map((s) => s.httpMs));
          volumeResult[path] = {
            statuses: [...new Set(measured.map((s) => s.status))],
            median: round(stats.median),
            p95: round(stats.p95),
            max: round(stats.max),
            db: round(mean(measured.map((s) => s.summary.db))),
            queries: round(mean(measured.map((s) => s.summary.dbQueries))),
            class: classifyHttp(stats.p95),
          };
        }
        if (count === 100) {
          const isolation = await timedFetch("GET", "/api/leads?pageSize=5");
          try {
            const payload = JSON.parse(isolation.text) as { items?: Array<{ firstName?: string }> };
            const names = (payload.items ?? []).map((row) => row.firstName ?? "");
            extras.volumeIsolation = {
              status: isolation.status,
              names,
              allVolPrefix: names.length > 0 && names.every((name) => name.startsWith("Vol")),
            };
          } catch {
            extras.volumeIsolation = { status: isolation.status, parseError: true };
          }
        }
        (extras.volume as Record<string, unknown>)[String(count)] = volumeResult;
        console.info(`[HTTP] volume=${count} leads median GET /api/leads=${(volumeResult["/api/leads?pageSize=100"] as { median?: number }).median}`);
      }
    } finally {
      await prisma.workspace.delete({ where: { id: perfWs.id } }).catch(() => undefined);
      await prisma.user.delete({ where: { id: perfUserId } }).catch(() => undefined);
    }

    await cleanupHarnessLeads();
    writeResults();
  } catch (error) {
    try {
      writeResults();
    } catch {
      /* keep original error */
    }
    throw error;
  } finally {
    await cleanupHarnessLeads().catch(() => undefined);
    if (harnessUserId) {
      await prisma.workspaceMember.deleteMany({ where: { userId: harnessUserId } }).catch(() => undefined);
      await prisma.user.delete({ where: { id: harnessUserId } }).catch(() => undefined);
    }
    stopServer(child);
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error("[HTTP] harness failed:", error instanceof Error ? error.message : error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
