import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = verifySessionToken(request.cookies.get("deplo_session")?.value, process.env.DEPLO_SESSION_SECRET ?? "");
  if (!user) return NextResponse.redirect(new URL("/?github_app=signin_required", request.nextUrl.origin));
  const slug = process.env.GITHUB_APP_SLUG?.trim();
  const appId = process.env.GITHUB_APP_ID?.trim();
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.trim();
  if (!slug || !/^[a-zA-Z0-9-]{1,100}$/.test(slug) || !appId || !privateKey) {
    return NextResponse.json({ error: "GitHub App installation is not configured yet." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const state = randomBytes(32).toString("hex");
  const destination = new URL("https://github.com/apps/" + slug + "/installations/new");
  destination.searchParams.set("state", state);
  const response = NextResponse.redirect(destination);
  response.cookies.set("deplo_github_app_state", state, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax",
    path: "/api/auth/github/install/callback", maxAge: 10 * 60,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
