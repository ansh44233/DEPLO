import test from "node:test";
import assert from "node:assert/strict";
import { AsyncBuildRunnerError, getIsolatedBuildStatus, submitIsolatedBuild } from "../../lib/deploy/async-build-runner";

const env = { DEPLO_BUILD_RUNNER_URL: "https://runner.example", DEPLO_BUILD_RUNNER_TOKEN: "r".repeat(48) };
const job = { jobId: "00000000-0000-4000-8000-000000000001", sourceCommitSha: "a".repeat(40), framework: "vite" as const, packageManager: "pnpm" as const, outputDirectory: "dist" as const };

test("submits a build asynchronously with a stable idempotency key", async () => {
  let capturedUrl = ""; let capturedInit: RequestInit | undefined;
  const fetcher: typeof fetch = async (url, init) => { capturedUrl = String(url); capturedInit = init; return Response.json({ runnerJobId: "runner_job_123" }, { status: 202 }); };
  const result = await submitIsolatedBuild(job, env, fetcher);
  assert.deepEqual(result, { runnerJobId: "runner_job_123" });
  assert.equal(capturedUrl, "https://runner.example/v1/builds");
  assert.equal(capturedInit?.method, "POST");
  assert.equal(capturedInit?.redirect, "error");
  assert.equal(capturedInit?.credentials, "omit");
  const headers = capturedInit?.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer " + env.DEPLO_BUILD_RUNNER_TOKEN);
  assert.equal(headers["Idempotency-Key"], job.jobId);
  assert.equal(JSON.parse(String(capturedInit?.body)).limits.networkPolicy, "deny-by-default");
});

test("rejects malformed acknowledgements and non-202 responses", async () => {
  await assert.rejects(submitIsolatedBuild(job, env, async () => Response.json({ runnerJobId: "../bad" }, { status: 202 })), /invalid job identifier/i);
  await assert.rejects(submitIsolatedBuild(job, env, async () => Response.json({ runnerJobId: "ok" })), /HTTP 202/i);
});

test("reads queued and running states", async () => {
  for (const status of ["queued", "running"] as const) {
    const result = await getIsolatedBuildStatus("runner_job_123", env, async () => Response.json({ status }));
    assert.deepEqual(result, { status });
  }
});

test("reads and validates successful and failed terminal results", async () => {
  const success = await getIsolatedBuildStatus("runner_job_123", env, async () => Response.json({
    status: "succeeded", result: { status: "succeeded", artifactId: "artifact_123", outputFileCount: 12, outputBytes: 4096 },
  }));
  assert.deepEqual(success, { status: "succeeded", result: { status: "succeeded", artifactId: "artifact_123", outputFileCount: 12, outputBytes: 4096 } });
  const failed = await getIsolatedBuildStatus("runner_job_123", env, async () => Response.json({
    status: "failed", result: { status: "failed", errorCode: "build_failed" },
  }));
  assert.deepEqual(failed, { status: "failed", result: { status: "failed", errorCode: "build_failed" } });
});

test("rejects unsafe IDs, mismatched terminal status, and unknown statuses", async () => {
  await assert.rejects(getIsolatedBuildStatus("../escape", env), /invalid runner job identifier/i);
  await assert.rejects(getIsolatedBuildStatus("runner_job_123", env, async () => Response.json({
    status: "succeeded", result: { status: "failed", errorCode: "build_failed" },
  })), /do not match/i);
  await assert.rejects(getIsolatedBuildStatus("runner_job_123", env, async () => Response.json({ status: "secret" })), /unsupported job status/i);
});

test("does not contact the runner without server configuration", async () => {
  let called = false;
  await assert.rejects(submitIsolatedBuild(job, {}, async () => { called = true; return Response.json({}); }),
    (error: unknown) => error instanceof AsyncBuildRunnerError && error.code === "not_configured");
  assert.equal(called, false);
});
