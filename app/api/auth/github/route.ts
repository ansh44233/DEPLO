import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getCallbackUrl(): string | null {
  const configuredBase = process.env.DEPLO_BASE_URL;
  if (!configuredBase) return null;
  try {
    const base = new URL(configuredBase);
    if (base.protocol !== "https:" && base.hostname !== "localhost") return null;
    return new URL("/api/auth/github/callback", base).toString();
  } catch {
    return null;
  }
}

export async function GET() {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const callbackUrl = getCallbackUrl();
  if (!clientId || !process.env.GITHUB_CLIENT_SECRET || !callbackUrl || (process.env.DEPLO_SESSION_SECRET?.length ?? 0) < 32 || (process.env.GITHUB_TOKEN_ENCRYPTION_KEY?.length ?? 0) < 32) {
    return NextResponse.json(
      { error: "GitHub sign-in is not configured. Set GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, DEPLO_SESSION_SECRET, GITHUB_TOKEN_ENCRYPTION_KEY, and DEPLO_BASE_URL." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const state = randomBytes(32).toString("hex");
  const authorizationUrl = new URL("https://github.com/login/oauth/authorize");
  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set("redirect_uri", callbackUrl);
  authorizationUrl.searchParams.set("scope", "read:user repo");
  authorizationUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set("deplo_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/github/callback",
    maxAge: 10 * 60,
  });
  return response;
}
