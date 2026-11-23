import { NextResponse, type NextRequest } from "next/server";
import { unverifiedSessionId } from "@/lib/auth/session";
import { isSessionRevoked } from "@/lib/db/supabase-session-revocations";
import { crossSiteRejection, securityHeaders } from "@/lib/security/http";

const expiredCookie = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: 0 };

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  let response: NextResponse;

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
      response = NextResponse.next();
    }
  }

  const headers = securityHeaders({
    https: request.nextUrl.protocol === "https:",
    development: process.env.NODE_ENV === "development",
  });
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
}

export const config = {
  // Node.js runtime (stable in Next.js 15.5) so the session helpers can use node:crypto and Buffer.
  runtime: "nodejs",
  // Everything except Next.js build assets, which are immutable static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
