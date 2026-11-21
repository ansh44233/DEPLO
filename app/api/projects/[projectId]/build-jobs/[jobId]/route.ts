import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/auth/session";
import { BuildJobStoreError, cancelOwnedBuildJob } from "@/lib/db/supabase-build-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ projectId: string; jobId: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function DELETE(request: NextRequest, context: RouteContext) {
  const user = verifySessionToken(request.cookies.get("deplo_session")?.value, process.env.DEPLO_SESSION_SECRET ?? "");
  if (!user) return NextResponse.json({ error: "Sign in with GitHub to cancel a build job." }, { status: 401 });
  const { projectId, jobId } = await context.params;
  if (!UUID.test(projectId) || !UUID.test(jobId)) return NextResponse.json({ error: "Invalid project or build job ID." }, { status: 400 });
  try {
    const job = await cancelOwnedBuildJob(user.id, projectId, jobId);
    if (!job) return NextResponse.json({ error: "Pending or processing build job not found in this project." }, { status: 404 });
    return NextResponse.json({ job }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    const status = error instanceof BuildJobStoreError ? error.status : 502;
    const message = error instanceof BuildJobStoreError ? error.message : "The build job could not be cancelled.";
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
