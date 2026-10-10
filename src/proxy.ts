import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { applySecurityHeaders, buildCsp, newNonce } from "@/lib/security/headers";
import { isCrossOriginMutation, isOversizedBody, isPublicPath } from "@/lib/security/request-guards";
import { createRequestId } from "@/lib/perf";

/**
 * First gate only: rejects missing/expired JWTs, cross-origin API mutations and oversized bodies.
 * The authoritative session + membership check is in the DAL (requirePermission / requireAppAccess).
 */
export default auth((req) => {
  const requestId = createRequestId(req.headers.get("x-request-id"));
  const { pathname } = req.nextUrl;
  // Next reads the nonce from the request's CSP header while rendering and tags its own scripts with it (see
  // docs: content-security-policy). Pages must therefore render per request, which the root layout enforces.
  const nonce = newNonce();
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", buildCsp(nonce));

  let response: NextResponse;
  if (isCrossOriginMutation(req.method, pathname, req.headers)) {
    response = NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
  } else if (isOversizedBody(pathname, req.headers)) {
    response = NextResponse.json({ error: "Request body too large" }, { status: 413 });
  } else if (isPublicPath(pathname) || req.auth) {
    response = NextResponse.next({ request: { headers: requestHeaders } });
  } else {
    response = NextResponse.redirect(
      new URL(`/login?callbackUrl=${encodeURIComponent(`${pathname}${req.nextUrl.search}`)}`, req.nextUrl.origin),
    );
  }

  applySecurityHeaders(response.headers, nonce);
  // API responses carry CRM data/PII: never store them in shared or browser caches.
  if (pathname.startsWith("/api/")) response.headers.set("Cache-Control", "no-store");
  response.headers.set("x-request-id", requestId);
  return response;
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
