import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/auth/session";
import { getOwnedProjectById, ProjectStoreError } from "@/lib/db/supabase-projects";
import { readCloudflarePagesCredentials } from "@/lib/deploy/cloudflare-pages";
import { ensureCloudflarePagesProject, getAccountPagesTarget } from "@/lib/deploy/cloudflare-projects";
import { addPagesDomain, listPagesDomains, normalizeCustomDomain, removePagesDomain } from "@/lib/deploy/cloudflare-domains";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ projectId: string }> };

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
function validProjectId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
async function resolveTarget(request: NextRequest, context: RouteContext) {
  const user = verifySessionToken(request.cookies.get("deplo_session")?.value, process.env.DEPLO_SESSION_SECRET ?? "");
  if (!user) throw Object.assign(new Error("Sign in with GitHub to manage custom domains."), { status: 401 });
  const { projectId } = await context.params;
  if (!validProjectId(projectId)) throw Object.assign(new Error("Invalid project ID."), { status: 400 });
  const project = await getOwnedProjectById(user.id, projectId);
  if (!project) throw Object.assign(new Error("Project not found in your account."), { status: 404 });
  if (!project.deployment_url) throw Object.assign(new Error("Deploy this project before adding a custom domain."), { status: 409 });
  const credentials = readCloudflarePagesCredentials(process.env);
  if (!credentials) throw Object.assign(new Error("Cloudflare Pages is not configured on the server."), { status: 503 });
  const target = getAccountPagesTarget(credentials, user.id, project.slug);
  await ensureCloudflarePagesProject(target.config, target.productionBranch);
  return target.config;
}
function handleError(error: unknown) {
  if (error instanceof ProjectStoreError) return errorResponse(error.message, error.status);
  const status = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : 502;
  return errorResponse(error instanceof Error ? error.message : "Custom-domain operation failed.", status);
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const config = await resolveTarget(request, context);
    const domains = await listPagesDomains(config);
    return NextResponse.json({ domains }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return handleError(error); }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const config = await resolveTarget(request, context);
    let body: unknown;
    try { body = await request.json(); } catch { return errorResponse("Send a valid JSON request body.", 400); }
    if (typeof body !== "object" || body === null || !("domain" in body) || typeof body.domain !== "string") {
      return errorResponse("A domain name is required.", 400);
    }
    let domain: string;
    try { domain = normalizeCustomDomain(body.domain); }
    catch (error) { return errorResponse(error instanceof Error ? error.message : "Invalid domain name.", 400); }
    const attached = await addPagesDomain(config, domain);
    return NextResponse.json({ domain: attached }, { status: 201, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return handleError(error); }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const config = await resolveTarget(request, context);
    const domain = request.nextUrl.searchParams.get("domain") ?? "";
    await removePagesDomain(config, domain);
    return NextResponse.json({ deleted: true, domain }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return handleError(error); }
}
