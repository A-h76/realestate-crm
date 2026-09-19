import { AsyncLocalStorage } from "node:async_hooks";

export type PerfThreshold = "FAST" | "NORMAL" | "SLOW" | "VERY_SLOW" | "CRITICAL";

export const PERF_THRESHOLDS = {
  FAST: 200,
  NORMAL: 500,
  SLOW: 1000,
  VERY_SLOW: 2000,
} as const;

const SLOW_DB_MS = 100;

type DbSlowQuery = {
  verb: string;
  durationMs: number;
};

type PerfStore = {
  requestId: string;
  operation: string;
  spans: Array<{ name: string; durationMs: number; ok: boolean }>;
  db: { count: number; totalMs: number; slow: DbSlowQuery[] };
  external: { count: number; totalMs: number };
};

const als = new AsyncLocalStorage<PerfStore>();

export function classifyDuration(ms: number): PerfThreshold {
  if (ms < PERF_THRESHOLDS.FAST) return "FAST";
  if (ms < PERF_THRESHOLDS.NORMAL) return "NORMAL";
  if (ms < PERF_THRESHOLDS.SLOW) return "SLOW";
  if (ms < PERF_THRESHOLDS.VERY_SLOW) return "VERY_SLOW";
  return "CRITICAL";
}

export function createRequestId(incoming?: string | null): string {
  if (incoming && /^[A-Za-z0-9_-]{8,64}$/.test(incoming)) return incoming;
  return crypto.randomUUID();
}

export function getRequestId(): string | undefined {
  return als.getStore()?.requestId;
}

export function getPerfSnapshot(): PerfStore | undefined {
  return als.getStore();
}

function logPerf(entry: {
  operation: string;
  durationMs: number;
  requestId?: string;
  ok?: boolean;
  status?: number;
  dbQueryCount?: number;
  dbMs?: number;
  externalCount?: number;
  externalMs?: number;
}) {
  const parts = [
    "[PERF]",
    entry.requestId ? `requestId=${entry.requestId}` : null,
    `operation=${entry.operation}`,
    `duration=${Math.round(entry.durationMs)}ms`,
    `threshold=${classifyDuration(entry.durationMs)}`,
    entry.status != null ? `status=${entry.status}` : null,
    entry.ok === false ? "ok=false" : null,
    entry.dbQueryCount != null ? `dbQueries=${entry.dbQueryCount}` : null,
    entry.dbMs != null ? `db=${Math.round(entry.dbMs)}ms` : null,
    entry.externalCount != null ? `external=${entry.externalCount}` : null,
    entry.externalMs != null ? `externalMs=${Math.round(entry.externalMs)}ms` : null,
  ].filter(Boolean);
  console.info(parts.join(" "));
}

export function recordPrismaQuery(durationMs: number, sql: string) {
  const verb = sql.trim().split(/\s+/)[0]?.replace(/"/g, "").toUpperCase() || "SQL";
  const store = als.getStore();
  if (store) {
    store.db.count += 1;
    store.db.totalMs += durationMs;
    if (durationMs >= SLOW_DB_MS) {
      store.db.slow.push({ verb, durationMs });
      logPerf({
        operation: `DB:${verb}`,
        durationMs,
        requestId: store.requestId,
        ok: true,
      });
    }
    return;
  }
  if (durationMs >= SLOW_DB_MS) {
    logPerf({ operation: `DB:${verb}`, durationMs, ok: true });
  }
}

export function recordExternalCall(input: {
  provider: string;
  method: string;
  durationMs: number;
  status?: number | string;
  ok: boolean;
}) {
  const store = als.getStore();
  if (store) {
    store.external.count += 1;
    store.external.totalMs += input.durationMs;
  }
  logPerf({
    operation: `EXT:${input.provider}:${input.method}`,
    durationMs: input.durationMs,
    requestId: store?.requestId,
    ok: input.ok,
    status: typeof input.status === "number" ? input.status : undefined,
  });
}

export async function runWithPerfContext<T>(
  input: { requestId: string; operation: string },
  fn: () => Promise<T>,
): Promise<T> {
  const store: PerfStore = {
    requestId: input.requestId,
    operation: input.operation,
    spans: [],
    db: { count: 0, totalMs: 0, slow: [] },
    external: { count: 0, totalMs: 0 },
  };
  return als.run(store, fn);
}

export async function measureExecution<T>(
  name: string,
  fn: () => Promise<T> | T,
  options?: { silent?: boolean },
): Promise<T> {
  const start = performance.now();
  let ok = true;
  try {
    return await fn();
  } catch (error) {
    ok = false;
    throw error;
  } finally {
    const durationMs = performance.now() - start;
    const store = als.getStore();
    store?.spans.push({ name, durationMs, ok });
    if (!options?.silent) {
      logPerf({
        operation: name,
        durationMs,
        requestId: store?.requestId,
        ok,
      });
    }
  }
}

function withResponseHeaders(response: Response, mutate: (headers: Headers) => void): Response {
  const headers = new Headers(response.headers);
  const cookies =
    typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  if (cookies.length > 0) {
    headers.delete("set-cookie");
    for (const cookie of cookies) headers.append("set-cookie", cookie);
  }
  mutate(headers);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function attachRequestId(response: Response, requestId: string): Response {
  return withResponseHeaders(response, (headers) => {
    headers.set("x-request-id", requestId);
  });
}

function spanTotal(store: PerfStore, match: (name: string) => boolean): number {
  return store.spans.filter((span) => match(span.name)).reduce((sum, span) => sum + span.durationMs, 0);
}

/**
 * Compact numeric timing for local HTTP harnesses. No payloads, tokens, or PII.
 * Enabled only when PERF_HTTP_HEADERS=true.
 */
export function attachPerfSummary(response: Response, requestId: string): Response {
  return withResponseHeaders(response, (headers) => {
    headers.set("x-request-id", requestId);
    if (process.env.PERF_HTTP_HEADERS !== "true") return;
    const store = als.getStore();
    if (!store) return;
    const parts = [
      `db=${Math.round(store.db.totalMs)}`,
      `dbQueries=${store.db.count}`,
      `extMs=${Math.round(store.external.totalMs)}`,
      `ext=${store.external.count}`,
      `auth=${Math.round(spanTotal(store, (name) => name === "auth.session" || name === "auth.passwordVerify"))}`,
      `authz=${Math.round(spanTotal(store, (name) => name.startsWith("authz.")))}`,
      `parse=${Math.round(spanTotal(store, (name) => name.includes("parse") || name.includes("Validate")))}`,
      `auto=${Math.round(spanTotal(store, (name) => name.startsWith("automation.") || name === "csv.automations"))}`,
    ];
    headers.set("x-perf-summary", parts.join(";"));
  });
}

type RouteHandler<TContext = unknown> = (
  request: Request,
  context: TContext,
) => Promise<Response> | Response;

export function measuredRoute<TContext = unknown>(
  operation: string,
  handler: RouteHandler<TContext>,
  options?: { attachHeaders?: boolean },
): RouteHandler<TContext> {
  return async (request, context) => {
    const requestId = createRequestId(request.headers.get("x-request-id"));
    return runWithPerfContext({ requestId, operation }, async () => {
      const started = performance.now();
      let status = 500;
      let ok = true;
      try {
        const response = await handler(request, context);
        status = response.status;
        if (options?.attachHeaders === false) return response;
        return attachPerfSummary(response, requestId);
      } catch (error) {
        ok = false;
        throw error;
      } finally {
        const store = als.getStore();
        logPerf({
          operation,
          durationMs: performance.now() - started,
          requestId,
          ok,
          status,
          dbQueryCount: store?.db.count,
          dbMs: store?.db.totalMs,
          externalCount: store?.external.count,
          externalMs: store?.external.totalMs,
        });
      }
    });
  };
}
