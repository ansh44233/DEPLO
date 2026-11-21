import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/auth/session";
import { getOwnedProjectById, ProjectStoreError } from "@/lib/db/supabase-projects";
import { readCloudflarePagesCredentials } from "@/lib/deploy/cloudflare-pages";
import { listCloudflarePagesDeployments } from "@/lib/deploy/cloudflare-history";
import { getAccountPagesTarget } from "@/lib/deploy/cloudflare-projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message, deployments: [] }, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export async function GET(request: NextRequest) {
  const user = verifySessionToken(
    request.cookies.get("deplo_session")?.value,
    process.env.DEPLO_SESSION_SECRET ?? "",
  );
  if (!user) return errorResponse("Sign in with GitHub to view deployment history.", 401);

  const projectId = request.nextUrl.searchParams.get("projectId") ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId)) {
    return errorResponse("A valid projectId is required.", 400);
  }

  let project;
  try {
    project = await getOwnedProjectById(user.id, projectId);
  } catch (error) {
    if (error instanceof ProjectStoreError) return errorResponse(error.message, error.status);
    return errorResponse("Project storage is temporarily unavailable.", 502);
  }
  if (!project) return errorResponse("Project not found in your account.", 404);

  const config = readCloudflarePagesCredentials(process.env);
  if (!config) return errorResponse("Cloudflare Pages is not configured.", 503);

  let pagesTarget;
  try {
    pagesTarget = getAccountPagesTarget(config, user.id, project.slug);
  } catch {
    return errorResponse("The account project has invalid Cloudflare deployment settings.", 422);
  }

  try {
    const allDeployments = await listCloudflarePagesDeployments(pagesTarget.config);
    const deployments = allDeployments.filter((deployment) => deployment.branch === pagesTarget.productionBranch);
    return NextResponse.json({ deployments }, {
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return errorResponse("Deployment history is temporarily unavailable.", 502);
  }
}
