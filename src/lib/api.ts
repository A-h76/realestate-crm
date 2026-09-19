import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import type { WorkspaceRole } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { roleHasPermission, type Permission } from "@/lib/authz";
import { enforceRateLimit, type RateLimitSpec } from "@/lib/rate-limit";
import { getRequestId, measureExecution } from "@/lib/perf";

export { ApiError };

export type WorkspaceAccess = {
  session: Session;
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
};

export async function requireSession(): Promise<Session> {
  return measureExecution("auth.session", async () => {
    const session = (await auth()) as Session | null;
    if (!session?.user?.id || !session.user.workspaceId) {
      throw new ApiError(401, "Unauthorized");
    }
    return session;
  });
}

export async function requireWorkspaceAccess(explicitWorkspaceId?: string): Promise<WorkspaceAccess> {
  const session = await requireSession();
  const workspaceId = session.user.workspaceId;

  if (explicitWorkspaceId && explicitWorkspaceId !== workspaceId) {
    throw new ApiError(403, "Cross-workspace access denied");
  }

  const membership = await measureExecution("authz.membership", async () =>
    prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: session.user.id,
        },
      },
      select: { role: true },
    }),
  );

  if (!membership) {
    throw new ApiError(403, "Workspace access denied");
  }

  return {
    session,
    userId: session.user.id,
    workspaceId,
    role: membership.role,
  };
}

export async function requirePermission(
  permission: Permission | Permission[],
  options?: {
    request?: Request;
    rateLimit?: RateLimitSpec;
  },
): Promise<WorkspaceAccess> {
  const access = await requireWorkspaceAccess();
  const needed = Array.isArray(permission) ? permission : [permission];
  for (const item of needed) {
    if (!roleHasPermission(access.role, item)) {
      throw new ApiError(403, "Insufficient permissions");
    }
  }
  if (options?.rateLimit) {
    await measureExecution("authz.rateLimit", () => enforceRateLimit(options.rateLimit!));
  }
  return access;
}

export async function requireRole(roles: WorkspaceRole | WorkspaceRole[]): Promise<WorkspaceAccess> {
  const access = await requireWorkspaceAccess();
  const allowed = Array.isArray(roles) ? roles : [roles];
  if (!allowed.includes(access.role)) {
    throw new ApiError(403, "Insufficient permissions");
  }
  return access;
}

function requestIdHeaders(extra?: Record<string, string>) {
  const requestId = getRequestId();
  if (!requestId) return extra;
  return { ...extra, "x-request-id": requestId };
}

export function jsonOk<T>(data: T, status = 200) {
  return NextResponse.json(data, { status, headers: requestIdHeaders() });
}

export function jsonError(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status, headers: requestIdHeaders(error.headers) },
    );
  }
  console.error(error instanceof Error ? error.message : "unhandled_error");
  return NextResponse.json(
    { error: "Internal server error" },
    { status: 500, headers: requestIdHeaders() },
  );
}
