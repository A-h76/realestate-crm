import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { clientIp } from "@/lib/security/request";
import { parseBody } from "@/lib/validations/common";
import { acceptSetupToken, setupPasswordSchema } from "@/lib/workspace/account-setup";
import { measuredRoute } from "@/lib/perf";

const acceptSchema = z.object({ token: z.string().min(20).max(200), password: setupPasswordSchema });

/** Public (no session): the one-time token in the body is the credential. */
export const POST = measuredRoute("POST /api/auth/accept-invite", async (request: Request) => {
  try {
    await enforceRateLimit({ key: `accept-invite:${clientIp(request)}`, ...RATE_LIMITS.acceptInvite });
    const { token, password } = parseBody(acceptSchema, await request.json());
    await acceptSetupToken(token, password);
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
});
