import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/auth/session";
import { getDeploymentReadiness } from "@/lib/deploy/readiness";
import { hostUploadLimitBytes } from "@/lib/hosting/platform";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const readiness = getDeploymentReadiness(process.env);
  // Signed-out visitors learn only whether deploys work, not which server settings are missing.
  const signedIn = Boolean(verifySessionToken(request.cookies.get("deplo_session")?.value, process.env.DEPLO_SESSION_SECRET ?? ""));
  return NextResponse.json({ ...readiness, missing: signedIn ? readiness.missing : [], maxUploadBytes: hostUploadLimitBytes() }, {
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
