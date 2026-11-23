import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/auth/session";
import { getOwnedProjectById, ProjectStoreError } from "@/lib/db/supabase-projects";
import { createStagedUpload, StagedUploadError } from "@/lib/uploads/staged-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ projectId: string }> };
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

/** Issues a one-time signed URL so the browser can upload a large ZIP straight to private storage. */
export async function POST(request: NextRequest, context: RouteContext) {
  const user = verifySessionToken(request.cookies.get("deplo_session")?.value, process.env.DEPLO_SESSION_SECRET ?? "");
  if (!user) return NextResponse.json({ error: "Sign in with GitHub to upload." }, { status: 401, headers });
  const { projectId } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId)) {
    return NextResponse.json({ error: "Invalid project ID." }, { status: 400, headers });
  }
  try {
    const project = await getOwnedProjectById(user.id, projectId);
    if (!project) return NextResponse.json({ error: "Project not found in your account." }, { status: 404, headers });
    if (project.source_type !== "zip" && project.source_type !== "html") return NextResponse.json({ error: "Only upload projects accept files." }, { status: 422, headers });
    const staged = await createStagedUpload(user.id, project.id, project.source_type);
    return NextResponse.json(staged, { headers });
  } catch (error) {
    if (error instanceof StagedUploadError || error instanceof ProjectStoreError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    return NextResponse.json({ error: "An upload link could not be created." }, { status: 502, headers });
  }
}
