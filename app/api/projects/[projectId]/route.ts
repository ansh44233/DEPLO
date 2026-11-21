import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/auth/session";
import { deleteOwnedProject, ProjectStoreError } from "@/lib/db/supabase-projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function DELETE(request: NextRequest, context: RouteContext) {
  const user = verifySessionToken(
    request.cookies.get("deplo_session")?.value,
    process.env.DEPLO_SESSION_SECRET ?? "",
  );
  if (!user) {
    return NextResponse.json({ error: "Sign in with GitHub to delete a project." }, {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const { projectId } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId)) {
    return NextResponse.json({ error: "Invalid project ID." }, {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    const deleted = await deleteOwnedProject(user.id, projectId);
    if (!deleted) {
      return NextResponse.json({ error: "Project not found in your account." }, {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      });
    }
    return NextResponse.json({ deleted: true, projectId }, {
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const status = error instanceof ProjectStoreError ? error.status : 502;
    const message = error instanceof ProjectStoreError
      ? error.message
      : "Project storage is temporarily unavailable.";
    return NextResponse.json({ error: message }, {
      status,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
