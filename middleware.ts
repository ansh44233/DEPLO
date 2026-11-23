import { NextResponse, type NextRequest } from "next/server";
import { unverifiedSessionId } from "@/lib/auth/session";
import { refreshGitHubCookieIfNeeded } from "@/lib/auth/github-refresh";
import { isSessionRevoked } from "@/lib/db/supabase-session-revocations";
import { crossSiteRejection, securityHeaders } from "@/lib/security/http";

const cookieBase = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" };
const expiredCookie = { ...cookieBase, maxAge: 0 };

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  let response: NextResponse;
  // A fresh nonce per request: Next.js reads it from the request's CSP header and stamps its scripts.
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const headers = securityHeaders({
    https: request.nextUrl.protocol === "https:",
    development: process.env.NODE_ENV === "development",
    nonce,
  });
  const forward = () => {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("Content-Security-Policy", headers["Content-Security-Policy"]);
    requestHeaders.set("x-nonce", nonce);
    return NextResponse.next({ request: { headers: requestHeaders } });
  };

  const rejection = crossSiteRejection({
    method: request.method,
    pathname,
    requestOrigin: request.nextUrl.origin,
    origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site"),
  });
  if (rejection) {
    response = NextResponse.json({ error: rejection }, { status: 403, headers: { "Cache-Control": "no-store" } });
  } else {
    // A signed-out session is refused even if a copy of its cookie is still around.
    const sid = pathname.startsWith("/api/") ? unverifiedSessionId(request.cookies.get("deplo_session")?.value) : null;
    if (sid && await isSessionRevoked(sid)) {
      response = NextResponse.json({ error: "This session has been signed out. Sign in again." }, { status: 401, headers: { "Cache-Control": "no-store" } });
      response.cookies.set("deplo_session", "", expiredCookie);
      response.cookies.set("deplo_github_token", "", expiredCookie);
    } else {
      // GitHub App user tokens expire after 8 hours; swap in a fresh one before the route reads it.
      const refreshed = pathname.startsWith("/api/") && !pathname.startsWith("/api/auth/logout")
        ? await refreshGitHubCookieIfNeeded(request.cookies.get("deplo_github_token")?.value)
        : null;
      if (refreshed) {
        request.cookies.set("deplo_github_token", refreshed);
        response = forward();
        response.cookies.set("deplo_github_token", refreshed, { ...cookieBase, maxAge: 60 * 60 * 24 * 7 });
      } else {
        response = forward();
      }
    }
  }

  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
}

export const config = {
  // Node.js runtime (stable in Next.js 15.5) so the session helpers can use node:crypto and Buffer.
  runtime: "nodejs",
  // Everything except Next.js build assets, which are immutable static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
