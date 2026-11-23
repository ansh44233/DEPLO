import { NextRequest, NextResponse } from "next/server";
import { decryptGitHubToken } from "@/lib/auth/github-token";
import { verifySessionToken } from "@/lib/auth/session";
import { listUserRepositories } from "@/lib/github/list-repositories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(request: NextRequest) {
  const user = verifySessionToken(request.cookies.get("deplo_session")?.value, process.env.DEPLO_SESSION_SECRET ?? "");
  if (!user) return NextResponse.json({ error: "Sign in with GitHub to list your repositories." }, { status: 401, headers });
  const accessToken = decryptGitHubToken(request.cookies.get("deplo_github_token")?.value, process.env.GITHUB_TOKEN_ENCRYPTION_KEY ?? "");
  if (!accessToken) return NextResponse.json({ error: "Your GitHub sign-in expired. Sign in again to list repositories." }, { status: 401, headers });
  try {
    const repositories = await listUserRepositories(accessToken);
    return NextResponse.json({ repositories }, { headers });
  } catch (error) {
    const status = typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 502;
    return NextResponse.json({ error: error instanceof Error ? error.message : "GitHub repositories could not be loaded." }, { status, headers });
  }
}
