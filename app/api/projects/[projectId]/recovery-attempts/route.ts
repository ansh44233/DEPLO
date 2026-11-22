import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/auth/session";
import { getOwnedProjectById, ProjectStoreError } from "@/lib/db/supabase-projects";
import { listOwnedBuildJobs, BuildJobStoreError } from "@/lib/db/supabase-build-jobs";
import {
  listDurableSupervisorRecoveriesForJobs,
  SupervisorRecoveryStoreError,
} from "@/lib/db/supabase-supervisor-recovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ projectId: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export async function GET(request: NextRequest, context: RouteContext) {
  const user = verifySessionToken(
    request.cookies.get("deplo_session")?.value,
    process.env.DEPLO_SESSION_SECRET ?? "",
  );
  if (!user) return fail("Sign in with GitHub to view recovery history.", 401);

  const { projectId } = await context.params;
  if (!UUID.test(projectId)) return fail("Invalid project ID.", 400);

  try {
    const project = await getOwnedProjectById(user.id, projectId);
    if (!project) return fail("Project not found in your account.", 404);

    // Job IDs are derived only from the owner-scoped project query. They are
    // the authorization boundary for the service-role recovery-history read.
    const jobs = await listOwnedBuildJobs(user.id, projectId);
    const attempts = await listDurableSupervisorRecoveriesForJobs(jobs.map((job) => job.id));
    return NextResponse.json({ attempts }, {
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) {
    if (error instanceof ProjectStoreError || error instanceof BuildJobStoreError || error instanceof SupervisorRecoveryStoreError) {
      return fail(error.message, error.status);
    }
    return fail("Recovery history is temporarily unavailable.", 502);
  }
}
