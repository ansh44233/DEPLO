import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/auth/session";
import { getOwnedProjectById, ProjectStoreError } from "@/lib/db/supabase-projects";
import { parsePublicGitHubUrl } from "@/lib/github/parse-repository-url";
import { sanitizeWebhookErrorCode } from "@/lib/github/webhook-deliveries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ projectId: string }> };
type DeliveryRow = {
  delivery_id: string; repository_full_name: string; branch: string; commit_sha: string;
  status: "received" | "processing" | "deployed" | "ignored" | "failed";
  received_at: string; processed_at: string | null; attempt_count: number;
  available_at: string; last_error_code: string | null;
};

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message, deliveries: [] }, {
    status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export async function GET(request: NextRequest, context: RouteContext) {
  const user = verifySessionToken(request.cookies.get("deplo_session")?.value, process.env.DEPLO_SESSION_SECRET ?? "");
  if (!user) return errorResponse("Sign in with GitHub to view webhook activity.", 401);
  const { projectId } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId)) {
    return errorResponse("Invalid project ID.", 400);
  }
  let project;
  try { project = await getOwnedProjectById(user.id, projectId); }
  catch (error) {
    if (error instanceof ProjectStoreError) return errorResponse(error.message, error.status);
    return errorResponse("Project storage is temporarily unavailable.", 502);
  }
  if (!project) return errorResponse("Project not found in your account.", 404);
  if (project.source_type !== "github" || !project.repository_url || !project.branch) {
    return NextResponse.json({ deliveries: [] }, { headers: { "Cache-Control": "no-store" } });
  }
  const repository = parsePublicGitHubUrl(project.repository_url);
  if (!repository) return errorResponse("The saved GitHub repository URL is invalid.", 422);
  const rawUrl = process.env.SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!rawUrl || !serviceKey) return errorResponse("Webhook activity storage is not configured.", 503);
  let baseUrl: string;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") throw new Error("Invalid protocol");
    baseUrl = parsed.toString();
    if (baseUrl.endsWith("/")) baseUrl = baseUrl.slice(0, -1);
  } catch { return errorResponse("Webhook activity storage is not configured.", 503); }
  const repositoryFullName = repository.owner + "/" + repository.repository;
  const query = new URLSearchParams({
    select: "delivery_id,repository_full_name,branch,commit_sha,status,received_at,processed_at,attempt_count,available_at,last_error_code",
    repository_full_name: "eq." + repositoryFullName, branch: "eq." + project.branch,
    order: "received_at.desc", limit: "20",
  });
  try {
    const response = await fetch(new URL("/rest/v1/github_webhook_deliveries?" + query.toString(), baseUrl), {
      headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey, Accept: "application/json" },
      cache: "no-store", signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return errorResponse("GitHub delivery activity is temporarily unavailable.", 502);
    const rows = await response.json() as DeliveryRow[];
    const deliveries = Array.isArray(rows) ? rows.map((row) => ({
      ...row,
      attempt_count: Number.isInteger(row.attempt_count) && row.attempt_count >= 0 ? row.attempt_count : 0,
      last_error_code: sanitizeWebhookErrorCode(row.last_error_code),
    })) : [];
    return NextResponse.json({ deliveries }, {
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch { return errorResponse("GitHub delivery activity is temporarily unavailable.", 502); }
}
