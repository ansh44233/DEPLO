import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/auth/session";
import { deleteOwnedProject, getOwnedProjectById, ProjectStoreError } from "@/lib/db/supabase-projects";
import { readCloudflarePagesCredentials } from "@/lib/deploy/cloudflare-pages";
import { deleteCloudflarePagesProject, getAccountPagesTarget } from "@/lib/deploy/cloudflare-projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ projectId: string }> };

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const user = verifySessionToken(
    request.cookies.get("deplo_session")?.value,
    process.env.DEPLO_SESSION_SECRET ?? "",
  );
  if (!user) return errorResponse("Sign in with GitHub to delete a project.", 401);

  const { projectId } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId)) {
    return errorResponse("Invalid project ID.", 400);
  }

  try {
    const project = await getOwnedProjectById(user.id, projectId);
    if (!project) return errorResponse("Project not found in your account.", 404);

    // Only projects that have been published need a provider cleanup call.
    // The target name is derived from the verified owner and the owned project slug.
    if (project.deployment_url) {
      const credentials = readCloudflarePagesCredentials(process.env);
      if (!credentials) return errorResponse("Cloudflare credentials are required to remove this hosted project safely.", 503);
      const target = getAccountPagesTarget(credentials, user.id, project.slug);
      await deleteCloudflarePagesProject(target.config);
    }

    // Provider deletion happens first. If the database delete fails, retrying is safe:
    // the provider helper treats a missing Pages project as already deleted.
    const deleted = await deleteOwnedProject(user.id, projectId);
    if (!deleted) return errorResponse("The project record could not be removed. Refresh and try again.", 409);

    return NextResponse.json({ deleted: true, projectId, hostedSiteRemoved: Boolean(project.deployment_url) }, {
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) {
    const status = error instanceof ProjectStoreError ? error.status : 502;
    const message = error instanceof ProjectStoreError
      ? error.message
      : "The hosted project could not be removed. The DEPLO project record was kept.";
    return errorResponse(message, status);
  }
}
