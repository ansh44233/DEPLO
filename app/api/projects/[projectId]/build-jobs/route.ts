import { after as afterResponse, NextRequest, NextResponse } from "next/server";
import { kickWorker } from "@/lib/workers/background";
import { verifySessionToken } from "@/lib/auth/session";
import { getOwnedProjectById, ProjectStoreError } from "@/lib/db/supabase-projects";
import { BuildJobStoreError, createOwnedBuildJob, listOwnedBuildJobs, type BuildFramework, type BuildPackageManager } from "@/lib/db/supabase-build-jobs";

import { claimDeploySlot, rateLimitMessage } from "@/lib/db/supabase-deploy-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ projectId: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FRAMEWORKS = ["vite", "react", "create-react-app", "nextjs-static"] as const;
const MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;

function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
function userFor(request: NextRequest) {
  return verifySessionToken(request.cookies.get("deplo_session")?.value, process.env.DEPLO_SESSION_SECRET ?? "");
}
function storageError(error: unknown) {
  if (error instanceof BuildJobStoreError || error instanceof ProjectStoreError) return fail(error.message, error.status);
  return fail("Build job storage is temporarily unavailable.", 502);
}

export async function GET(request: NextRequest, context: RouteContext) {
  const user = userFor(request);
  if (!user) return fail("Sign in with GitHub to view build jobs.", 401);
  const { projectId } = await context.params;
  if (!UUID.test(projectId)) return fail("Invalid project ID.", 400);
  try {
    const project = await getOwnedProjectById(user.id, projectId);
    if (!project) return fail("Project not found in your account.", 404);
    const jobs = await listOwnedBuildJobs(user.id, projectId);
    // While the owner is watching an active build, each refresh advances the worker by one step.
    // This keeps builds moving on hosts whose cron runs rarely (for example Vercel Hobby).
    if (jobs.some((job) => job.status === "pending" || job.status === "processing")) {
      afterResponse(() => kickWorker("/api/internal/build-jobs/process", process.env.DEPLO_BUILD_WORKER_SECRET));
    }
    return NextResponse.json({ jobs }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return storageError(error); }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const user = userFor(request);
  if (!user) return fail("Sign in with GitHub to queue a build.", 401);
  const { projectId } = await context.params;
  if (!UUID.test(projectId)) return fail("Invalid project ID.", 400);
  let body: unknown;
  try { body = await request.json(); } catch { return fail("Send build details as JSON.", 400); }
  if (!body || typeof body !== "object") return fail("Build details are required.", 400);
  const input = body as Record<string, unknown>;
  if (typeof input.sourceCommitSha !== "string" || !/^[a-f0-9]{40}$/.test(input.sourceCommitSha)) return fail("A full 40-character source commit SHA is required.", 400);
  if (!FRAMEWORKS.includes(input.framework as typeof FRAMEWORKS[number])) return fail("Unsupported framework build target.", 400);
  if (!MANAGERS.includes(input.packageManager as typeof MANAGERS[number])) return fail("Unsupported package manager.", 400);
  const framework = input.framework as BuildFramework;
  const outputDirectory = framework === "vite" ? "dist" : framework === "nextjs-static" ? "out" : "build";
  try {
    const project = await getOwnedProjectById(user.id, projectId);
    if (!project) return fail("Project not found in your account.", 404);
    if (project.source_type !== "github" || !project.repository_url || !project.branch) return fail("Build jobs currently require a saved GitHub project.", 422);
    const slot = await claimDeploySlot(user.id);
    if (!slot.allowed) {
      return NextResponse.json({ error: rateLimitMessage(slot) }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(slot.retryAfterSeconds) } });
    }
    const job = await createOwnedBuildJob({
      project_id: project.id, owner_github_id: user.id,
      source_commit_sha: input.sourceCommitSha, framework,
      package_manager: input.packageManager as BuildPackageManager, output_directory: outputDirectory,
    });
    afterResponse(() => kickWorker("/api/internal/build-jobs/process", process.env.DEPLO_BUILD_WORKER_SECRET));
    return NextResponse.json({ job, execution: "not_started" }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return storageError(error); }
}
