import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/auth/session";
import { getOwnedProjectById, ProjectStoreError } from "@/lib/db/supabase-projects";
import { EnvVarError, listProjectEnvVars, normaliseEnvVars, parseDotEnv, replaceProjectEnvVars } from "@/lib/db/supabase-env-vars";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ projectId: string }> };
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers });
}

async function owner(request: NextRequest, context: RouteContext) {
  const user = verifySessionToken(request.cookies.get("deplo_session")?.value, process.env.DEPLO_SESSION_SECRET ?? "");
  if (!user) throw new EnvVarError("Sign in with GitHub to manage environment variables.", 401);
  const { projectId } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId)) throw new EnvVarError("Invalid project ID.", 400);
  const project = await getOwnedProjectById(user.id, projectId);
  if (!project) throw new EnvVarError("Project not found in your account.", 404);
  return { userId: user.id, projectId };
}

function handle(error: unknown) {
  if (error instanceof EnvVarError || error instanceof ProjectStoreError) return errorResponse(error.message, error.status);
  return errorResponse("Environment variables could not be loaded.", 502);
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { userId, projectId } = await owner(request, context);
    return NextResponse.json({ variables: await listProjectEnvVars(userId, projectId) }, { headers });
  } catch (error) { return handle(error); }
}

/** Replaces the whole set. Body: { variables: [{ key, value }] } or { dotenv: "KEY=value\n..." }. */
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { userId, projectId } = await owner(request, context);
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > 1_000_000) return errorResponse("That is too much data for environment variables.", 413);
    const body = await request.json().catch(() => null) as { variables?: unknown; dotenv?: unknown } | null;
    if (!body) return errorResponse("Send JSON.", 400);
    const input = typeof body.dotenv === "string" ? parseDotEnv(body.dotenv) : body.variables;
    const variables = normaliseEnvVars(input);
    await replaceProjectEnvVars(userId, projectId, variables);
    return NextResponse.json({ variables }, { headers });
  } catch (error) { return handle(error); }
}
