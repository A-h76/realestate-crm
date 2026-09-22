import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { applySecurityHeaders } from "@/lib/security/headers";
import { createRequestId } from "@/lib/perf";

const PUBLIC_PATHS = new Set(["/login", "/api/health"]);
const PUBLIC_PREFIXES = ["/api/auth", "/api/webhooks/whatsapp"];

function isPublic(pathname: string) {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export default auth((req) => {
  const requestId = createRequestId(req.headers.get("x-request-id"));
  const response = isPublic(req.nextUrl.pathname)
    ? NextResponse.next()
    : req.auth
      ? NextResponse.next()
      : NextResponse.redirect(
          new URL(
            `/login?callbackUrl=${encodeURIComponent(`${req.nextUrl.pathname}${req.nextUrl.search}`)}`,
            req.nextUrl.origin,
          ),
        );
  applySecurityHeaders(response.headers);
  response.headers.set("x-request-id", requestId);
  return response;
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
