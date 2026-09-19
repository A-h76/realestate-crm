import { recordExternalCall } from "@/lib/perf";

/**
 * Provider-specific timeouts. Do not reuse one value for every network hop.
 * These are hang-protection deadlines, not latency SLAs.
 */
export const FETCH_TIMEOUTS_MS = {
  upstash: 800,
  openMeteo: 2500,
  whatsappGraph: 8000,
  googleCalendar: 8000,
  default: 5000,
} as const;

export class FetchTimeoutError extends Error {
  provider: string;
  timeoutMs: number;

  constructor(provider: string, timeoutMs: number) {
    super(`${provider} request timed out after ${timeoutMs}ms`);
    this.name = "FetchTimeoutError";
    this.provider = provider;
    this.timeoutMs = timeoutMs;
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError")
  );
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit & {
    timeoutMs: number;
    provider: string;
  },
): Promise<Response> {
  const { timeoutMs, provider, method, signal: _ignoredCallerSignal, ...rest } = init;
  const httpMethod = (method ?? "GET").toUpperCase();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  let status: number | string = "error";
  let ok = false;

  try {
    const response = await fetch(url, {
      ...rest,
      method,
      signal: controller.signal,
    });
    status = response.status;
    ok = response.ok;
    return response;
  } catch (error) {
    if (isAbortError(error) || controller.signal.aborted) {
      status = "timeout";
      throw new FetchTimeoutError(provider, timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    recordExternalCall({
      provider,
      method: httpMethod,
      durationMs: performance.now() - started,
      status,
      ok,
    });
  }
}
