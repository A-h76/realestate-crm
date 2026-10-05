import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { mock } from "node:test";
import type { WorkspaceRole } from "@prisma/client";
import { prisma } from "../../src/lib/db";

/**
 * HTTP-boundary test harness. Route handlers are invoked exactly as Next would
 * (Request in, Response out) — the only seam is the session lookup, replaced by
 * `actAs()`. Everything after it (membership lookup, RBAC, workspace scoping,
 * validation, Prisma, audit) is the real production code against a real database.
 * Requires `--experimental-test-module-mocks` (set in `npm test`).
 */
const sessionRef: { current: unknown } = { current: null };

let sessionMockInstalled = false;

export function installSessionMock(): void {
  if (sessionMockInstalled) return;
  sessionMockInstalled = true;
  mock.module(pathToFileURL(path.resolve("src/lib/auth.ts")).href, {
    namedExports: {
      getActiveSession: async () => sessionRef.current,
      // Same behaviour as src/lib/auth.ts, which member removal calls.
      revokeUserSessions: async (userId: string) =>
        (await prisma.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } })).count,
    },
  });
}

export const ROLES: WorkspaceRole[] = ["OWNER", "ADMIN", "MANAGER", "AGENT", "VIEWER"];

export type TestUser = { id: string; email: string; name: string; workspaceId: string; role: WorkspaceRole };

export function actAs(user: TestUser | null): void {
  sessionRef.current = user
    ? {
        user: { id: user.id, email: user.email, name: user.name, workspaceId: user.workspaceId, role: user.role },
        sid: "test-session",
        expires: new Date(Date.now() + 3600_000).toISOString(),
      }
    : null;
}

export type Tenant = {
  workspaceId: string;
  users: Record<WorkspaceRole, TestUser>;
  stages: { open: string; open2: string; won: string; lost: string };
};

/** A workspace with one user per role and an open/open/won/lost pipeline. */
export async function createTenant(label: string): Promise<Tenant> {
  const workspace = await prisma.workspace.create({ data: { name: label, slug: `${label}-${randomUUID()}` } });
  const users = {} as Record<WorkspaceRole, TestUser>;
  for (const role of ROLES) {
    const email = `${label}-${role.toLowerCase()}-${randomUUID()}@example.test`;
    const user = await prisma.user.create({ data: { email, name: `${label} ${role}`, passwordHash: "x" } });
    await prisma.workspaceMember.create({ data: { workspaceId: workspace.id, userId: user.id, role } });
    users[role] = { id: user.id, email, name: user.name, workspaceId: workspace.id, role };
  }
  const stage = (slug: string, order: number, extra: { isWon?: boolean; isLost?: boolean; probability?: number }) =>
    prisma.pipelineStage
      .create({ data: { workspaceId: workspace.id, name: slug, slug, order, active: true, ...extra } })
      .then((s) => s.id);
  const stages = {
    open: await stage("open", 1, { probability: 20 }),
    open2: await stage("open2", 2, { probability: 60 }),
    won: await stage("won", 3, { isWon: true, probability: 100 }),
    lost: await stage("lost", 4, { isLost: true, probability: 0 }),
  };
  return { workspaceId: workspace.id, users, stages };
}

export async function destroyTenant(tenant: Tenant): Promise<void> {
  await prisma.workspace.delete({ where: { id: tenant.workspaceId } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(tenant.users).map((u) => u.id) } } });
}

type Handler = (request: Request, context: never) => Response | Promise<Response>;

// Response bodies are untyped JSON; tests assert on the fields they care about.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ResponseBody = any;

export async function call(
  handler: Handler,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  options: { params?: Record<string, string>; body?: unknown; query?: string; headers?: Record<string, string>; rawBody?: string } = {},
): Promise<{ status: number; body: ResponseBody }> {
  const request = new Request(`http://localhost/api/test${options.query ?? ""}`, {
    method,
    headers: { "content-type": "application/json", origin: "http://localhost", ...options.headers },
    body: options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
  });
  const response = await handler(request, { params: Promise.resolve(options.params ?? {}) } as never);
  const text = await response.text();
  let body: ResponseBody = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

/** A fresh client IP per call keeps IP-keyed rate limits from leaking between tests. */
export function freshIp(): { "x-real-ip": string } {
  const octet = () => 1 + Math.floor(Math.random() * 253);
  return { "x-real-ip": `10.${octet()}.${octet()}.${octet()}` };
}
