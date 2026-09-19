import { ApiError } from "@/lib/errors";
import { isDemoMode } from "@/lib/demo-mode";
import { prisma } from "@/lib/db";
import { FETCH_TIMEOUTS_MS, FetchTimeoutError, fetchWithTimeout } from "@/lib/http";

export type RateLimitSpec = {
  key: string;
  limit: number;
  windowMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSec: number;
};

/**
 * Documented limits. Applied at the route, not globally on page renders.
 *
 * | Surface            | Key                    | Limit | Window   |
 * |--------------------|------------------------|-------|----------|
 * | Auth/login         | ip + email             | 5     | 15 min   |
 * | WhatsApp webhook   | ip                     | 120   | 1 min    |
 * | CSV import         | workspace + user       | 5     | 15 min   |
 * | CSV export         | workspace + user       | 10    | 15 min   |
 * | Intelligence / AI  | workspace + user       | 30    | 1 min    |
 * | Scoring            | workspace + user       | 30    | 1 min    |
 * | WhatsApp send/draft| workspace + user       | 30    | 1 min    |
 * | Search             | workspace + user       | 60    | 1 min    |
 * | Demo reset         | workspace + user       | 3     | 1 hour   |
 * | CRM mutations      | workspace + user       | 120   | 1 min    |
 */
export const RATE_LIMITS = {
  login: { limit: 5, windowMs: 15 * 60 * 1000 },
  webhook: { limit: 120, windowMs: 60 * 1000 },
  csvImport: { limit: 5, windowMs: 15 * 60 * 1000 },
  csvExport: { limit: 10, windowMs: 15 * 60 * 1000 },
  intelligence: { limit: 30, windowMs: 60 * 1000 },
  scoring: { limit: 30, windowMs: 60 * 1000 },
  whatsappSend: { limit: 30, windowMs: 60 * 1000 },
  search: { limit: 60, windowMs: 60 * 1000 },
  demoReset: { limit: 3, windowMs: 60 * 60 * 1000 },
  mutation: { limit: 120, windowMs: 60 * 1000 },
} as const;

type StoreIncrement = (key: string, windowMs: number) => Promise<{ count: number; resetAt: number }>;

const memoryBuckets = new Map<string, { count: number; resetAt: number }>();

function windowStart(windowMs: number): Date {
  const ms = Math.floor(Date.now() / windowMs) * windowMs;
  return new Date(ms);
}

async function incrementUpstash(key: string, windowMs: number): Promise<{ count: number; resetAt: number } | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  const start = windowStart(windowMs);
  const redisKey = `rl:${key}:${start.getTime()}`;
  const ttlSec = Math.ceil(windowMs / 1000) + 5;
  try {
    const response = await fetchWithTimeout(`${url.replace(/\/$/, "")}/pipeline`, {
      provider: "upstash",
      timeoutMs: FETCH_TIMEOUTS_MS.upstash,
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", redisKey],
        ["EXPIRE", redisKey, ttlSec],
      ]),
    });
    if (!response.ok) {
      throw new Error("upstash_rate_limit_failed");
    }
    const payload = (await response.json()) as Array<{ result?: number }>;
    const count = Number(payload[0]?.result ?? 0);
    return { count, resetAt: start.getTime() + windowMs };
  } catch (error) {
    if (error instanceof FetchTimeoutError) return null;
    throw error;
  }
}

async function incrementPostgres(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
  const start = windowStart(windowMs);
  const rows = await prisma.$queryRaw<Array<{ count: number }>>`
    INSERT INTO "RateLimitBucket" ("key", "windowStart", "count")
    VALUES (${key}, ${start}, 1)
    ON CONFLICT ("key", "windowStart")
    DO UPDATE SET "count" = "RateLimitBucket"."count" + 1
    RETURNING "count"
  `;
  return { count: Number(rows[0]?.count ?? 1), resetAt: start.getTime() + windowMs };
}

function incrementMemory(key: string, windowMs: number): { count: number; resetAt: number } {
  const start = windowStart(windowMs);
  const bucketKey = `${key}:${start.getTime()}`;
  const existing = memoryBuckets.get(bucketKey);
  if (!existing || existing.resetAt <= Date.now()) {
    const next = { count: 1, resetAt: start.getTime() + windowMs };
    memoryBuckets.set(bucketKey, next);
    return { ...next };
  }
  existing.count += 1;
  return { ...existing };
}

const increment: StoreIncrement = async (key, windowMs) => {
  try {
    const upstash = await incrementUpstash(key, windowMs);
    if (upstash) return upstash;
    return await incrementPostgres(key, windowMs);
  } catch (error) {
    if (isDemoMode() || process.env.NODE_ENV === "test") {
      return incrementMemory(key, windowMs);
    }
    throw error;
  }
};

export async function rateLimit(spec: RateLimitSpec): Promise<RateLimitResult> {
  const { count, resetAt } = await increment(spec.key, spec.windowMs);
  const retryAfterSec = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  const allowed = count <= spec.limit;
  return {
    allowed,
    limit: spec.limit,
    remaining: Math.max(0, spec.limit - count),
    retryAfterSec,
  };
}

export async function enforceRateLimit(spec: RateLimitSpec): Promise<RateLimitResult> {
  let result: RateLimitResult;
  try {
    result = await rateLimit(spec);
  } catch {
    if (isDemoMode() || process.env.NODE_ENV === "test") {
      result = { allowed: true, limit: spec.limit, remaining: spec.limit, retryAfterSec: 1 };
    } else {
      throw new ApiError(503, "Rate limiter unavailable");
    }
  }
  if (!result.allowed) {
    throw new ApiError(429, "Too many requests", {
      "Retry-After": String(result.retryAfterSec),
      "X-RateLimit-Limit": String(result.limit),
      "X-RateLimit-Remaining": "0",
    });
  }
  return result;
}

export { incrementMemory };
