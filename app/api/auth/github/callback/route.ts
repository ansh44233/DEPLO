import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, safeEqual } from "@/lib/auth/session";
import { encryptGitHubToken } from "@/lib/auth/github-token";
import { exchangeGitHubCode, revokeGitHubToken } from "@/lib/auth/github-oauth";
import { isAllowedGitHubUser } from "@/lib/auth/access-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GitHubProfile = { id?: number; login?: string; name?: string | null; avatar_url?: string | null };

function callbackUrl(): string | null {
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

function finish(request: NextRequest, result: "error" | "success" | "denied", sessionToken?: string, encryptedGitHubToken?: string) {
  let destination: URL;
  try {
    destination = new URL("/", process.env.DEPLO_BASE_URL || request.nextUrl.origin);
  } catch {
    destination = new URL("/", request.nextUrl.origin);
  }
  destination.searchParams.set("auth", result);
  const response = NextResponse.redirect(destination);
  response.cookies.set("deplo_oauth_state", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/github/callback",
    maxAge: 0,
  });
  response.cookies.set("deplo_github_token", encryptedGitHubToken ?? "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: encryptedGitHubToken ? 60 * 60 * 24 * 7 : 0,
  });
  if (sessionToken) {
    response.cookies.set("deplo_session", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
  }
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state") ?? "";
  const savedState = request.cookies.get("deplo_oauth_state")?.value ?? "";
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  const sessionSecret = process.env.DEPLO_SESSION_SECRET;
  const tokenEncryptionKey = process.env.GITHUB_TOKEN_ENCRYPTION_KEY;
  const redirectUri = callbackUrl();

  if (
    !code || !state || !savedState || !safeEqual(state, savedState) ||
    !clientId || !clientSecret || !sessionSecret || sessionSecret.length < 32 || !tokenEncryptionKey || tokenEncryptionKey.length < 32 || !redirectUri
  ) {
    console.error("[deplo] GitHub sign-in rejected before token exchange:", !code ? "missing_code" : !state || !savedState || !safeEqual(state, savedState) ? "state_mismatch" : "server_not_configured");
    return finish(request, "error");
  }

  try {
    const exchanged = await exchangeGitHubCode({ clientId, clientSecret, code, redirectUri });
    if ("error" in exchanged) {
      console.error("[deplo] GitHub sign-in failed at token exchange:", exchanged.error);
      return finish(request, "error");
    }
    const tokenData = { access_token: exchanged.accessToken };

    const profileResponse = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer " + tokenData.access_token,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "DEPLO",
      },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!profileResponse.ok) {
      console.error("[deplo] GitHub sign-in failed reading the profile:", profileResponse.status);
      return finish(request, "error");
    }
    const profile = await profileResponse.json() as GitHubProfile;
    if (
      !Number.isSafeInteger(profile.id) || (profile.id ?? 0) <= 0 ||
      typeof profile.login !== "string" || !/^[a-zA-Z0-9-]{1,39}$/.test(profile.login)
    ) return finish(request, "error");

    if (!isAllowedGitHubUser({ id: profile.id as number, login: profile.login })) {
      console.error("[deplo] GitHub sign-in refused: account is not on DEPLO_ALLOWED_GITHUB_USERS");
      await revokeGitHubToken({ clientId, clientSecret, accessToken: tokenData.access_token });
      return finish(request, "denied");
    }

    const avatarUrl = typeof profile.avatar_url === "string" &&
      profile.avatar_url.startsWith("https://") ? profile.avatar_url : null;
    const token = createSessionToken({
      id: profile.id as number,
      login: profile.login,
      name: typeof profile.name === "string" ? profile.name.slice(0, 100) : null,
      avatarUrl,
    }, sessionSecret);
    const encryptedToken = encryptGitHubToken(tokenData.access_token, tokenEncryptionKey);
    return finish(request, "success", token, encryptedToken);
  } catch {
    console.error("[deplo] GitHub sign-in failed: unexpected error");
    return finish(request, "error");
  }
}
