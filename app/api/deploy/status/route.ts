import { NextResponse } from "next/server";
import { getDeploymentReadiness } from "@/lib/deploy/readiness";
import { hostUploadLimitBytes } from "@/lib/hosting/platform";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const readiness = { ...getDeploymentReadiness(process.env), maxUploadBytes: hostUploadLimitBytes() };
  return NextResponse.json(readiness, {
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
