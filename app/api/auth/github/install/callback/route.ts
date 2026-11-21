import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, safeEqual } from "@/lib/auth/session";
import { createGitHubAppJwt } from "@/lib/github/app-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InstallationResponse = { id?: number; account?: { id?: number; login?: string; type?: string } };

function finish(request: NextRequest, result: "connected" | "error" | "cancelled") {
  const response = NextResponse.redirect(new URL("/?github_app=" + result, process.env.DEPLO_BASE_URL || request.nextUrl.origin));
  response.cookies.set("deplo_github_app_state", "", {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax",
    path: "/api/auth/github/install/callback", maxAge: 0,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: NextRequest) {
  const user = verifySessionToken(request.cookies.get("deplo_session")?.value, process.env.DEPLO_SESSION_SECRET ?? "");
  const state = request.nextUrl.searchParams.get("state") ?? "";
  const savedState = request.cookies.get("deplo_github_app_state")?.value ?? "";
  if (!user || !state || !savedState || !safeEqual(state, savedState)) return finish(request, "error");
  if (request.nextUrl.searchParams.get("setup_action") === "install" && !request.nextUrl.searchParams.has("installation_id")) {
    return finish(request, "error");
  }
  if (request.nextUrl.searchParams.get("setup_action") === "cancel") return finish(request, "cancelled");
  const installationId = Number(request.nextUrl.searchParams.get("installation_id"));
  const appId = process.env.GITHUB_APP_ID?.trim() ?? "";
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY ?? "";
  const baseUrl = process.env.SUPABASE_URL?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!Number.isSafeInteger(installationId) || installationId <= 0 || !appId || !privateKey || !baseUrl || !serviceKey) {
    return finish(request, "error");
  }
  try {
    const jwt = createGitHubAppJwt(appId, privateKey);
    const installationResponse = await fetch("https://api.github.com/app/installations/" + installationId, {
      headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + jwt, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "DEPLO" },
      cache: "no-store", signal: AbortSignal.timeout(8_000),
    });
    if (!installationResponse.ok) return finish(request, "error");
    const installation = await installationResponse.json() as InstallationResponse;
    const account = installation.account;
    if (
      installation.id !== installationId ||
      !Number.isSafeInteger(account?.id) || (account?.id ?? 0) <= 0 ||
      typeof account?.login !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(account.login) ||
      (account.type !== "User" && account.type !== "Organization")
    ) return finish(request, "error");

    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") return finish(request, "error");
    const endpoint = new URL("/rest/v1/github_app_installations?on_conflict=owner_github_id", parsed);
    const stored = await fetch(endpoint, {
      method: "POST",
      headers: {
        apikey: serviceKey, Authorization: "Bearer " + serviceKey,
        "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        owner_github_id: user.id, installation_id: installationId,
        account_login: account.login, account_type: account.type, suspended_at: null, updated_at: new Date().toISOString(),
      }),
      cache: "no-store", signal: AbortSignal.timeout(8_000),
    });
    if (!stored.ok) return finish(request, "error");
    return finish(request, "connected");
  } catch {
    return finish(request, "error");
  }
}
