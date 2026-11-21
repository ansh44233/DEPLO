import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { encryptGitHubSession, githubSessionCookieName, githubSessionMaxAge } from "@/lib/auth/github-session";

export const runtime = "nodejs";

type GitHubTokenResponse = { access_token?: string; error?: string };
type GitHubUser = { login?: string };

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  const expectedState = request.cookies.get("deplo_github_oauth_state")?.value;
  const suppliedState = request.nextUrl.searchParams.get("state") ?? "";
  const code = request.nextUrl.searchParams.get("code");

  const fail = (message: string, status = 400) => {
    const response = NextResponse.redirect(new URL("/?auth=error", appUrl ?? request.nextUrl.origin));
    response.cookies.delete("deplo_github_oauth_state");
    response.cookies.delete(githubSessionCookieName);
    response.headers.set("Cache-Control", "no-store");
    return status === 400 ? response : NextResponse.json({ error: message }, { status });
  };

  if (!appUrl || !clientId || !clientSecret) {
    return NextResponse.json({ error: "GitHub OAuth server configuration is incomplete." }, { status: 503 });
  }
  if (!code || !expectedState || !suppliedState || !safeEqual(expectedState, suppliedState)) {
    return fail("GitHub OAuth state validation failed.");
  }

  try {
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!tokenResponse.ok) return fail("GitHub token exchange failed.", 502);
    const tokenData = (await tokenResponse.json()) as GitHubTokenResponse;
    if (!tokenData.access_token) return fail("GitHub did not return an access token.");

    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer " + tokenData.access_token,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "DEPLO",
      },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!userResponse.ok) return fail("Could not verify the GitHub account.", 502);
    const user = (await userResponse.json()) as GitHubUser;
    if (!user.login) return fail("GitHub returned an invalid account profile.", 502);

    const encryptedSession = await encryptGitHubSession(tokenData.access_token, user.login);
    const response = NextResponse.redirect(new URL("/", appUrl));
    response.cookies.delete("deplo_github_oauth_state");
    response.cookies.set(githubSessionCookieName, encryptedSession, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: githubSessionMaxAge,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return fail("GitHub sign-in could not be completed. Please try again.", 502);
  }
}
