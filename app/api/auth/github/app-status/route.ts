import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export async function GET(request: NextRequest) {
  const user = verifySessionToken(
    request.cookies.get("deplo_session")?.value,
    process.env.DEPLO_SESSION_SECRET ?? "",
  );
  if (!user) return response({ error: "Sign in to view GitHub App status." }, 401);

  const baseUrl = process.env.SUPABASE_URL?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  const appConfigured = Boolean(
    process.env.GITHUB_APP_ID?.trim() &&
    process.env.GITHUB_APP_SLUG?.trim() &&
    process.env.GITHUB_APP_PRIVATE_KEY?.trim()
  );
  if (!baseUrl || !serviceKey) {
    return response({ configured: appConfigured, connected: false, accountLogin: null, accountType: null });
  }

  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
      return response({ error: "GitHub App status storage is not configured." }, 503);
    }
    const endpoint = new URL("/rest/v1/github_app_installations", parsed);
    endpoint.searchParams.set("select", "account_login,account_type,suspended_at");
    endpoint.searchParams.set("owner_github_id", "eq." + user.id);
    endpoint.searchParams.set("limit", "1");
    const result = await fetch(endpoint, {
      headers: {
        apikey: serviceKey,
        Authorization: "Bearer " + serviceKey,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!result.ok) return response({ error: "GitHub App status is temporarily unavailable." }, 502);
    const rows = await result.json() as { account_login?: unknown; account_type?: unknown; suspended_at?: unknown }[];
    const row = rows[0];
    const accountLogin = typeof row?.account_login === "string" ? row.account_login : null;
    const accountType = row?.account_type === "User" || row?.account_type === "Organization"
      ? row.account_type
      : null;
    const suspended = typeof row?.suspended_at === "string" && row.suspended_at.length > 0;
    return response({
      configured: appConfigured,
      connected: Boolean(accountLogin && accountType && !suspended),
      suspended,
      accountLogin,
      accountType,
    });
  } catch {
    return response({ error: "GitHub App status is temporarily unavailable." }, 502);
  }
}
