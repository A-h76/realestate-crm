import { handlers } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { clientIp, identifierKey } from "@/lib/security/request";
import { NextRequest } from "next/server";
import { measuredRoute } from "@/lib/perf";

const { GET: nextAuthGet, POST: nextAuthPost } = handlers;

export const GET = measuredRoute(
  "GET /api/auth/:nextauth",
  async (request) => nextAuthGet(request as NextRequest),
  { attachHeaders: false },
);

export const POST = measuredRoute(
  "POST /api/auth/:nextauth",
  async (request) => {
    try {
      const nextRequest = request as NextRequest;
      const url = new URL(nextRequest.url);
      const isCredentials =
        url.pathname.includes("/callback/credentials") || url.pathname.endsWith("/signin");
      if (!isCredentials) {
        return nextAuthPost(nextRequest);
      }

      const contentType = nextRequest.headers.get("content-type") ?? "";
      const rawBody = await nextRequest.text();
      let email = "unknown";
      if (contentType.includes("application/json")) {
        try {
          const parsed = JSON.parse(rawBody) as { email?: string };
          email = identifierKey(parsed.email);
        } catch {
          email = "unknown";
        }
      } else {
        email = identifierKey(new URLSearchParams(rawBody).get("email") ?? undefined);
      }

      await enforceRateLimit({
        key: `auth:login:${clientIp(nextRequest)}:${email}`,
        ...RATE_LIMITS.login,
      });

      const forwarded = new NextRequest(nextRequest.url, {
        method: "POST",
        headers: nextRequest.headers,
        body: rawBody,
      });
      return nextAuthPost(forwarded);
    } catch (error) {
      return jsonError(error);
    }
  },
  { attachHeaders: false },
);
