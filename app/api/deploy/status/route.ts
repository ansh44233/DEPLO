import { NextResponse } from "next/server";
import { getDeploymentReadiness } from "@/lib/deploy/readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const readiness = getDeploymentReadiness(process.env);
  return NextResponse.json(readiness, {
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
