import { z } from "zod";
import { jsonError, jsonOk, requirePermission } from "@/lib/api";
import { ASSIGNABLE_ROLES } from "@/lib/authz";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { parseBody } from "@/lib/validations/common";
import { inviteWorkspaceMember } from "@/lib/workspace/invite-member";
import { measuredRoute } from "@/lib/perf";

const inviteSchema = z.object({
  email: z.string().trim().email().max(254),
  name: z.string().trim().min(1).max(120),
  role: z.enum(ASSIGNABLE_ROLES),
});

function appOrigin(request: Request): string {
  const configured = process.env.AUTH_URL || process.env.NEXTAUTH_URL;
  return (configured || new URL(request.url).origin).replace(/\/+$/, "");
}

export const POST = measuredRoute("POST /api/workspace/members", async (request: Request) => {
  try {
    const access = await requirePermission("members:manage");
    await enforceRateLimit({ key: `mut:${access.workspaceId}:${access.userId}`, ...RATE_LIMITS.mutation });
    const body = parseBody(inviteSchema, await request.json());

    const result = await inviteWorkspaceMember({
      workspaceId: access.workspaceId,
      actorId: access.userId,
      email: body.email,
      name: body.name,
      role: body.role,
    });

    // The link is a credential: returned once, to the admin who must pass it on, never stored in plaintext.
    // The token sits in the URL fragment so it is not sent to servers or logged by proxies.
    return jsonOk({
      member: { userId: result.userId, email: result.email, role: result.role },
      setupUrl: result.setup ? `${appOrigin(request)}/accept-invite#token=${result.setup.token}` : null,
      setupExpiresAt: result.setup?.expiresAt.toISOString() ?? null,
    });
  } catch (error) {
    return jsonError(error);
  }
});
