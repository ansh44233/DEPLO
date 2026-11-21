import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import {
  attachRunnerJob, claimNextBuildJob, claimNextRunnerPollJob, finishBuildJob,
  releaseRunnerPollClaim, saveRunnerArtifact, scheduleRunnerPoll,
} from "@/lib/db/supabase-build-jobs";
import { AsyncBuildRunnerError, getIsolatedBuildStatus, submitIsolatedBuild } from "@/lib/deploy/async-build-runner";
import { readBuildRunnerConfiguration } from "@/lib/deploy/build-runner-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function authorized(header: string | null, secret: string): boolean {
  if (secret.length < 32 || !header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
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
  return "runner_unavailable";
}

export async function POST(request: NextRequest) {
  if (!authorized(request.headers.get("authorization"), process.env.DEPLO_BUILD_WORKER_SECRET ?? "")) return response({ error: "Authentication required." }, 401);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return response({ error: "Build queue storage is not configured." }, 503);
  if (!readBuildRunnerConfiguration()) return response({ error: "The isolated build runner is not configured." }, 503);

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
      return response({ processed: true, action: "artifact-ready", jobId: pollJob.id, artifactValidated: false });
    } catch (error) {
      await releaseRunnerPollClaim(pollJob.id, 30).catch(() => undefined);
      return response({ processed: true, action: "poll-retry", jobId: pollJob.id, error: errorCode(error) }, 502);
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
    const code = errorCode(error);
    await finishBuildJob(job.id, "failed", code).catch(() => undefined);
    return response({ processed: true, action: "submit-retry", jobId: job.id, error: code }, 502);
  }
}
