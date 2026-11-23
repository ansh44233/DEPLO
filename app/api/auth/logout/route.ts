import { NextRequest, NextResponse } from "next/server";
import { verifySessionClaims } from "@/lib/auth/session";
import { decryptGitHubToken } from "@/lib/auth/github-token";
import { revokeGitHubToken } from "@/lib/auth/github-oauth";
import { revokeSession } from "@/lib/db/supabase-session-revocations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const expiredCookie = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 0,
};

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const configuredBase = process.env.DEPLO_BASE_URL;
  if (!configuredBase || !origin) {
    return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
  }
  try {
    if (new URL(origin).origin !== new URL(configuredBase).origin) {
      return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "Sign-out is not configured." }, { status: 503 });
  }

  // End this sign-in on the server too, so a copied cookie stops working.
  const claims = verifySessionClaims(request.cookies.get("deplo_session")?.value, process.env.DEPLO_SESSION_SECRET ?? "");
  let revoked = true;
  if (claims?.sid) {
    try {
      await revokeSession(claims.sid, claims.user.id, claims.exp);
    } catch {
      revoked = false;
      console.error("[deplo] Sign-out could not record the session revocation.");
    }
  }
  const githubToken = decryptGitHubToken(request.cookies.get("deplo_github_token")?.value, process.env.GITHUB_TOKEN_ENCRYPTION_KEY ?? "");
  if (githubToken) {
    await revokeGitHubToken({
      clientId: process.env.GITHUB_CLIENT_ID ?? "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
      accessToken: githubToken,
    });
  }

  const response = NextResponse.json({ signedOut: true, ...(revoked ? {} : { warning: "Signed out here, but other copies of this session could not be ended. They expire within 7 days." }) }, {
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
  response.cookies.set("deplo_session", "", expiredCookie);
  response.cookies.set("deplo_github_token", "", expiredCookie);
  return response;
}
