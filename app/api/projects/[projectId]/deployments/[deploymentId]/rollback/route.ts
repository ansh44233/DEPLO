import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/auth/session";
import { getOwnedProjectById, ProjectStoreError, updateOwnedProjectDeployment } from "@/lib/db/supabase-projects";
import { readCloudflarePagesCredentials } from "@/lib/deploy/cloudflare-pages";
import { listCloudflarePagesDeployments, rollbackCloudflarePagesDeployment } from "@/lib/deploy/cloudflare-history";
import { getAccountPagesTarget } from "@/lib/deploy/cloudflare-projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ projectId: string; deploymentId: string }> };

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest, context: RouteContext) {
  const user = verifySessionToken(
    request.cookies.get("deplo_session")?.value,
    process.env.DEPLO_SESSION_SECRET ?? "",
  );
  if (!user) return errorResponse("Sign in with GitHub to roll back a deployment.", 401);

  const { projectId, deploymentId } = await context.params;
  if (!UUID_PATTERN.test(projectId) || !UUID_PATTERN.test(deploymentId)) {
    return errorResponse("A valid project and deployment ID are required.", 400);
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

  let pagesTarget: ReturnType<typeof getAccountPagesTarget>;
  try {
    pagesTarget = getAccountPagesTarget(config, user.id, project.slug);
  } catch {
    return errorResponse("The account project has invalid Cloudflare deployment settings.", 422);
  }

  try {
    const deployments = await listCloudflarePagesDeployments(pagesTarget.config);
    const target = deployments.find((deployment) => deployment.id === deploymentId);
    if (!target || target.branch !== pagesTarget.productionBranch) {
      return errorResponse("This deployment does not belong to the selected project.", 404);
    }
    if (target.environment !== "production" || target.status !== "success") {
      return errorResponse("Only successful production deployments can be rolled back.", 422);
    }

    const deployment = await rollbackCloudflarePagesDeployment(pagesTarget.config, deploymentId);
    // The stable production URL stays the same; only what it serves changes.
    const productionUrl = project.deployment_url && /^https:\/\/[a-z0-9-]+\.pages\.dev$/.test(project.deployment_url) ? project.deployment_url : deployment.url;
    let savedProject;
    try {
      savedProject = await updateOwnedProjectDeployment(user.id, project.id, productionUrl);
    } catch {
      return NextResponse.json({
        status: "rolled_back",
        url: productionUrl,
        warning: "Cloudflare completed the rollback, but DEPLO could not update the saved project URL.",
      }, { status: 200, headers: { "Cache-Control": "no-store" } });
    }

    return NextResponse.json({
      status: "rolled_back",
      project: savedProject,
      deployment,
      url: productionUrl,
    }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return errorResponse("Cloudflare Pages could not complete the rollback. Refresh deployment history and try again.", 502);
  }
}
