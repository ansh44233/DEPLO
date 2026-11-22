import { NextRequest, NextResponse } from "next/server";
import { drainWorker, isAuthorizedWorkerRequest } from "@/lib/workers/background";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  attachRunnerJob, claimNextArtifactPublishJob, claimNextBuildJob, claimNextRunnerPollJob, finishBuildJob,
  releaseRunnerPollClaim, saveRunnerArtifact, scheduleRunnerPoll,
} from "@/lib/db/supabase-build-jobs";
import { getOwnedProjectById, updateOwnedProjectDeployment } from "@/lib/db/supabase-projects";
import { getActiveGitHubInstallationId, GitHubInstallationStoreError } from "@/lib/db/supabase-github-app-installations";
import { createInstallationAccessToken } from "@/lib/github/app-auth";
import { parsePublicGitHubUrl } from "@/lib/github/parse-repository-url";
import { downloadGitHubSourceArchive, GitHubSourceArchiveError } from "@/lib/github/build-source";
import { AsyncBuildRunnerError, getIsolatedBuildStatus, submitIsolatedBuild, uploadBuildSourceArchive } from "@/lib/deploy/async-build-runner";
import { downloadAndValidateBuildArtifact, BuildArtifactError } from "@/lib/deploy/build-artifact";
import { readBuildRunnerConfiguration } from "@/lib/deploy/build-runner-contract";
import { readCloudflarePagesCredentials, deployStaticDirectory } from "@/lib/deploy/cloudflare-pages";
import { ensureCloudflarePagesProject, getAccountPagesTarget } from "@/lib/deploy/cloudflare-projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
function errorCode(error: unknown): string {
  if (error instanceof AsyncBuildRunnerError) {
    if (error.code === "not_configured") return "runner_not_configured";
    if (error.code === "unavailable") return "runner_unavailable";
    if (error.code === "rejected") return "runner_rejected";
    return "runner_invalid_response";
  }
  if (error instanceof BuildArtifactError) {
    if (error.code === "not_configured") return "runner_not_configured";
    if (error.code === "unavailable") return "artifact_unavailable";
    if (error.code === "rejected") return "artifact_rejected";
    return "artifact_invalid";
  }
  if (error instanceof GitHubSourceArchiveError) return "github_source_" + error.code;
  if (error instanceof GitHubInstallationStoreError) return "github_installation_unavailable";
  return "build_worker_failed";
}

async function publishBuildArtifact(job: NonNullable<Awaited<ReturnType<typeof claimNextArtifactPublishJob>>>): Promise<string> {
  if (!job.artifact_id || job.artifact_file_count == null || job.artifact_bytes == null) {
    throw new BuildArtifactError("Build artifact metadata is incomplete.", "invalid_artifact");
  }
  const artifact = { artifactId: job.artifact_id, outputFileCount: job.artifact_file_count, outputBytes: job.artifact_bytes };
  const project = await getOwnedProjectById(job.owner_github_id, job.project_id);
  if (!project) throw new Error("The build job project is no longer available.");
  const credentials = readCloudflarePagesCredentials();
  if (!credentials) throw new Error("Cloudflare Pages is not configured.");
  const target = getAccountPagesTarget(credentials, job.owner_github_id, project.slug);
  const temporaryRoot = await mkdtemp(join(tmpdir(), "deplo-publish-"));
  try {
    const workDirectory = join(temporaryRoot, "artifact");
    const validated = await downloadAndValidateBuildArtifact(artifact, workDirectory);
    const { productionUrl } = await ensureCloudflarePagesProject(target.config, target.productionBranch);
    await deployStaticDirectory(validated.extractionDirectory, target.productionBranch, target.config);
    await updateOwnedProjectDeployment(job.owner_github_id, job.project_id, productionUrl);
    return productionUrl;
  } finally { await rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined); }
}

async function stageSourceForRunner(job: NonNullable<Awaited<ReturnType<typeof claimNextBuildJob>>>): Promise<{ sourceId: string; repositoryFullName: string }> {
  const project = await getOwnedProjectById(job.owner_github_id, job.project_id);
  if (!project || project.source_type !== "github" || !project.repository_url) throw new Error("A saved GitHub project is required for framework builds.");
  const repository = parsePublicGitHubUrl(project.repository_url);
  if (!repository) throw new Error("The saved GitHub repository URL is invalid.");
  const installationId = await getActiveGitHubInstallationId(job.owner_github_id);
  if (!installationId) throw new Error("A connected, active GitHub App installation is required to build this repository.");
  const appId = process.env.GITHUB_APP_ID?.trim() ?? "";
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.trim() ?? "";
  if (!appId || !privateKey) throw new Error("GitHub App source access is not configured.");
  const installationToken = await createInstallationAccessToken(installationId, appId, privateKey);
  const archive = await downloadGitHubSourceArchive(repository, job.source_commit_sha, installationToken);
  const repositoryFullName = repository.owner + "/" + repository.repository;
  const uploaded = await uploadBuildSourceArchive({
    jobId: job.id, sourceCommitSha: job.source_commit_sha, repositoryFullName, archive,
  });
  return { sourceId: uploaded.sourceId, repositoryFullName };
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedWorkerRequest(request.headers.get("authorization"), [process.env.DEPLO_BUILD_WORKER_SECRET])) return response({ error: "Authentication required." }, 401);
  return processNextBuildStep();
}

// Vercel Cron sends GET with `Authorization: Bearer $CRON_SECRET`; drain the queue as a backstop.
export async function GET(request: NextRequest) {
  if (!isAuthorizedWorkerRequest(request.headers.get("authorization"), [process.env.CRON_SECRET, process.env.DEPLO_BUILD_WORKER_SECRET])) return response({ error: "Authentication required." }, 401);
  const result = await drainWorker(processNextBuildStep);
  return response(result);
}

async function processNextBuildStep(): Promise<NextResponse> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return response({ error: "Build queue storage is not configured." }, 503);
  if (!readBuildRunnerConfiguration()) return response({ error: "The isolated build runner is not configured." }, 503);

  let publishJob: Awaited<ReturnType<typeof claimNextArtifactPublishJob>> = null;
  try { publishJob = await claimNextArtifactPublishJob(); }
  catch { return response({ error: "A validated artifact could not be claimed for publication." }, 502); }
  if (publishJob) {
    try {
      const deploymentUrl = await publishBuildArtifact(publishJob);
      await finishBuildJob(publishJob.id, "succeeded");
      return response({ processed: true, action: "deployed", jobId: publishJob.id, deploymentUrl });
    } catch (error) {
      const code = errorCode(error);
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
        await releaseRunnerPollClaim(pollJob.id, 30);
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
      const code = errorCode(error);
      await releaseRunnerPollClaim(pollJob.id, 30).catch(() => undefined);
      return response({ processed: true, action: "publish-retry", jobId: pollJob.id, error: code }, 502);
    }
  }

  let job: Awaited<ReturnType<typeof claimNextBuildJob>> = null;
  try { job = await claimNextBuildJob(); }
  catch { return response({ error: "A queued build job could not be claimed." }, 502); }
  if (!job) return response({ processed: false, reason: "queue-empty" });

  try {
    const source = await stageSourceForRunner(job);
    const submitted = await submitIsolatedBuild({
      jobId: job.id, sourceId: source.sourceId, sourceCommitSha: job.source_commit_sha,
      framework: job.framework, packageManager: job.package_manager, outputDirectory: job.output_directory,
    });
    const attached = await attachRunnerJob(job.id, submitted.runnerJobId);
    if (!attached) return response({ processed: true, action: "runner-accepted-needs-reconciliation", jobId: job.id }, 409);
    return response({ processed: true, action: "submitted", jobId: job.id, runnerJobId: submitted.runnerJobId });
  } catch (error) {
    const code = errorCode(error);
    await finishBuildJob(job.id, "failed", code).catch(() => undefined);
    return response({ processed: true, action: "submit-retry", jobId: job.id, error: code }, 502);
  }
}
