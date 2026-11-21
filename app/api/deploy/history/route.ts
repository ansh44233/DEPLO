import { NextResponse } from "next/server";
import { readCloudflarePagesConfig } from "@/lib/deploy/cloudflare-pages";
import { listCloudflarePagesDeployments } from "@/lib/deploy/cloudflare-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const config = readCloudflarePagesConfig(process.env);
  if (!config) {
    return NextResponse.json(
      { error: "Cloudflare Pages is not configured.", deployments: [] },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const deployments = await listCloudflarePagesDeployments(config);
    return NextResponse.json(
      { deployments },
      {
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch {
    return NextResponse.json(
      { error: "Deployment history is temporarily unavailable.", deployments: [] },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
