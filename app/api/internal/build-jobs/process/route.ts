import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import {
  attachRunnerJob, claimNextArtifactPublishJob, claimNextBuildJob, claimNextRunnerPollJob, finishBuildJob,
  releaseRunnerPollClaim, saveRunnerArtifact, scheduleRunnerPoll,
} from "@/lib/db/supabase-build-jobs";
import { getOwnedProjectById, updateOwnedProjectDeployment } from "@/lib/db/supabase-projects";
import { AsyncBuildRunnerError, getIsolatedBuildStatus, submitIsolatedBuild } from "@/lib/deploy/async-build-runner";
import { BuildArtifactError, downloadAndValidateBuildArtifact } from "@/lib/deploy/build-artifact";
import { readBuildRunnerConfiguration } from "@/lib/deploy/build-runner-contract";
import { deployStaticDirectory, readCloudflarePagesCredentials } from "@/lib/deploy/cloudflare-pages";
import { ensureCloudflarePagesProject, getAccountPagesTarget } from "@/lib/deploy/cloudflare-projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(header: string | null, secret: string): boolean {
  if (secret.length < 32 || !header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
function runnerErrorCode(error: unknown): string {
  if (error instanceof AsyncBuildRunnerError) {
    if (error.code === "not_configured") return "runner_not_configured";
    if (error.code === "unavailable") return "runner_unavailable";
    if (error.code === "rejected") return "runner_rejected";
    return "runner_invalid_response";
  }
  return "runner_unavailable";
}
function artifactErrorCode(error: unknown): string {
  if (error instanceof BuildArtifactError) {
    if (error.code === "not_configured") return "runner_not_configured";
    if (error.code === "unavailable") return "artifact_unavailable";
    if (error.code === "rejected") return "artifact_rejected";
    return "artifact_invalid";
  }
  return "artifact_publish_failed";
}

async function publishArtifact(job: NonNullable<Awaited<ReturnType<typeof claimNextArtifactPublishJob>>>) {
  const project = await getOwnedProjectById(job.owner_github_id, job.project_id);
  if (!project) throw new Error("project_unavailable");
  if (!job.artifact_id || job.artifact_file_count == null || job.artifact_bytes == null) {
    throw new BuildArtifactError("Build artifact metadata is incomplete.", "invalid_artifact");
  }
  const cloudflare = readCloudflarePagesCredentials();
  if (!cloudflare) throw new Error("cloudflare_not_configured");
  const target = getAccountPagesTarget(cloudflare, job.owner_github_id, project.slug);
  const workRoot = await mkdtemp(join(tmpdir(), "deplo-build-publish-"));
  try {
    const artifact = await downloadAndValidateBuildArtifact({
      artifactId: job.artifact_id,
      outputFileCount: job.artifact_file_count,
      outputBytes: job.artifact_bytes,
    }, join(workRoot, "artifact-work"));
    await ensureCloudflarePagesProject(target.config, target.productionBranch);
    const deployment = await deployStaticDirectory(artifact.extractionDirectory, target.productionBranch, target.config);
    await updateOwnedProjectDeployment(job.owner_github_id, project.id, deployment.url);
    return { url: deployment.url, fileCount: artifact.fileCount, totalBytes: artifact.totalBytes };
  } finally {
    await rm(workRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function POST(request: NextRequest) {
  if (!authorized(request.headers.get("authorization"), process.env.DEPLO_BUILD_WORKER_SECRET ?? "")) return response({ error: "Authentication required." }, 401);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return response({ error: "Build queue storage is not configured." }, 503);
  if (!readBuildRunnerConfiguration()) return response({ error: "The isolated build runner is not configured." }, 503);
  if (!readCloudflarePagesCredentials()) return response({ error: "Cloudflare Pages is not configured." }, 503);

  let publishJob: Awaited<ReturnType<typeof claimNextArtifactPublishJob>> = null;
  try { publishJob = await claimNextArtifactPublishJob(); }
  catch { return response({ error: "A validated artifact could not be claimed for publication." }, 502); }
  if (publishJob) {
    try {
      const deployment = await publishArtifact(publishJob);
      await finishBuildJob(publishJob.id, "succeeded");
      return response({ processed: true, action: "deployed", jobId: publishJob.id, ...deployment });
    } catch (error) {
      const code = error instanceof BuildArtifactError ? artifactErrorCode(error)
        : error instanceof Error && error.message === "project_unavailable" ? "project_unavailable"
        : error instanceof Error && error.message === "cloudflare_not_configured" ? "cloudflare_not_configured"
        : "cloudflare_publish_failed";
      await finishBuildJob(publishJob.id, "failed", code).catch(() => undefined);
      return response({ processed: true, action: "publish-retry", jobId: publishJob.id, error: code }, 502);
    }
  }

  let pollJob: Awaited<ReturnType<typeof claimNextRunnerPollJob>> = null;
  try { pollJob = await claimNextRunnerPollJob(); }
  catch { return response({ error: "A runner job could not be claimed for polling." }, 502); }

  if (pollJob?.runner_job_id) {
    try {
      const status = await getIsolatedBuildStatus(pollJob.runner_job_id);
      if (status.status === "queued" || status.status === "running") {
        await scheduleRunnerPoll(pollJob.id, status.status, status.status === "queued" ? 15 : 10);
        return response({ processed: true, action: "polled", jobId: pollJob.id, runnerStatus: status.status });
      }
      if (!("result" in status)) {
        return response({ processed: true, action: "poll-retry", jobId: pollJob.id, error: "runner_invalid_response" }, 502);
      }
      if (status.result.status === "failed") {
        await finishBuildJob(pollJob.id, "failed", status.result.errorCode);
        return response({ processed: true, action: "failed", jobId: pollJob.id, retryScheduled: pollJob.attempt_count < pollJob.max_attempts });
      }
      await saveRunnerArtifact(pollJob.id, {
        artifactId: status.result.artifactId,
        outputFileCount: status.result.outputFileCount,
        outputBytes: status.result.outputBytes,
      });
      return response({ processed: true, action: "artifact-ready", jobId: pollJob.id, publicationQueued: true });
    } catch (error) {
      await releaseRunnerPollClaim(pollJob.id, 30).catch(() => undefined);
      return response({ processed: true, action: "poll-retry", jobId: pollJob.id, error: runnerErrorCode(error) }, 502);
    }
  }

  let job: Awaited<ReturnType<typeof claimNextBuildJob>> = null;
  try { job = await claimNextBuildJob(); }
  catch { return response({ error: "A queued build job could not be claimed." }, 502); }
  if (!job) return response({ processed: false, reason: "queue-empty" });

  try {
    const submitted = await submitIsolatedBuild({
      jobId: job.id,
      sourceCommitSha: job.source_commit_sha,
      framework: job.framework,
      packageManager: job.package_manager,
      outputDirectory: job.output_directory,
    });
    const attached = await attachRunnerJob(job.id, submitted.runnerJobId);
    if (!attached) return response({ processed: true, action: "runner-accepted-needs-reconciliation", jobId: job.id }, 409);
    return response({ processed: true, action: "submitted", jobId: job.id, runnerJobId: submitted.runnerJobId });
  } catch (error) {
    const code = runnerErrorCode(error);
    await finishBuildJob(job.id, "failed", code).catch(() => undefined);
    return response({ processed: true, action: "submit-retry", jobId: job.id, error: code }, 502);
  }
}
