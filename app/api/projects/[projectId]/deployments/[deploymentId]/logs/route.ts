import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/auth/session";
import { getOwnedProjectById, ProjectStoreError } from "@/lib/db/supabase-projects";
import { readCloudflarePagesConfig } from "@/lib/deploy/cloudflare-pages";
import { getCloudflarePagesDeploymentLogs, listCloudflarePagesDeployments } from "@/lib/deploy/cloudflare-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ projectId: string; deploymentId: string }> };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message, logs: [] }, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export async function GET(request: NextRequest, context: RouteContext) {
  const user = verifySessionToken(
    request.cookies.get("deplo_session")?.value,
    process.env.DEPLO_SESSION_SECRET ?? "",
  );
  if (!user) return errorResponse("Sign in with GitHub to view deployment logs.", 401);

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

  const config = readCloudflarePagesConfig(process.env);
  if (!config) return errorResponse("Cloudflare Pages is not configured.", 503);

  try {
    const deployments = await listCloudflarePagesDeployments(config);
    const target = deployments.find((deployment) =>
      deployment.id === deploymentId && deployment.branch === "site-" + project.slug
    );
    if (!target) return errorResponse("Deployment not found in this project.", 404);

    const logs = await getCloudflarePagesDeploymentLogs(config, deploymentId);
    return NextResponse.json({ logs }, {
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return errorResponse("Deployment logs are temporarily unavailable.", 502);
  }
}
