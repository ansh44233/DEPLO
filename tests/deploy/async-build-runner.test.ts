import test from "node:test";
import assert from "node:assert/strict";
import { AsyncBuildRunnerError, getIsolatedBuildStatus, submitIsolatedBuild, uploadBuildSourceArchive } from "../../lib/deploy/async-build-runner";
const env = { DEPLO_BUILD_RUNNER_URL: "https://runner.example", DEPLO_BUILD_RUNNER_TOKEN: "r".repeat(48) };
const job = { jobId: "00000000-0000-4000-8000-000000000001", sourceId: "source_123", sourceCommitSha: "a".repeat(40),
  framework: "vite" as const, packageManager: "pnpm" as const, outputDirectory: "dist" as const };
const archive = new Uint8Array([0x50, 0x4b, 3, 4, 1, 2]);
test("uploads a bounded source archive with idempotency and metadata", async () => {
  let target = ""; let init: RequestInit | undefined;
  const result = await uploadBuildSourceArchive({ jobId: job.jobId, sourceCommitSha: job.sourceCommitSha,
    repositoryFullName: "octocat/hello-world", archive }, env, async (url, options) => {
      target = String(url); init = options; return Response.json({ sourceId: "source_123" }, { status: 201 });
    });
  assert.deepEqual(result, { sourceId: "source_123" }); assert.equal(target, "https://runner.example/v1/sources");
  assert.equal(init?.method, "POST"); assert.equal(init?.redirect, "error"); assert.equal(init?.credentials, "omit");
  assert.equal((init?.headers as Record<string, string>)["Idempotency-Key"], job.jobId);
  assert.ok(init?.body instanceof FormData);
  const form = init?.body as FormData;
  assert.deepEqual(JSON.parse(String(form.get("metadata"))), { sourceCommitSha: job.sourceCommitSha, repositoryFullName: "octocat/hello-world" });
  assert.ok(form.get("archive") instanceof Blob);
});
test("rejects invalid source archive metadata and runner source IDs", async () => {
  await assert.rejects(uploadBuildSourceArchive({ jobId: job.jobId, sourceCommitSha: "main", repositoryFullName: "octocat/hello-world", archive }, env), /invalid/i);
  await assert.rejects(uploadBuildSourceArchive({ jobId: job.jobId, sourceCommitSha: job.sourceCommitSha, repositoryFullName: "octocat/hello-world", archive }, env,
    async () => Response.json({ sourceId: "../bad" }, { status: 201 })), /source identifier/i);
});
test("submits a build asynchronously bound to the uploaded source", async () => {
  let capturedUrl = ""; let capturedInit: RequestInit | undefined;
  const result = await submitIsolatedBuild(job, env, async (url, init) => { capturedUrl = String(url); capturedInit = init; return Response.json({ runnerJobId: "runner_job_123" }, { status: 202 }); });
  assert.deepEqual(result, { runnerJobId: "runner_job_123" }); assert.equal(capturedUrl, "https://runner.example/v1/builds");
  assert.equal(capturedInit?.method, "POST"); assert.equal(capturedInit?.redirect, "error"); assert.equal(capturedInit?.credentials, "omit");
  const headers = capturedInit?.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer " + env.DEPLO_BUILD_RUNNER_TOKEN); assert.equal(headers["Idempotency-Key"], job.jobId);
  assert.equal(JSON.parse(String(capturedInit?.body)).sourceId, "source_123");
});
test("rejects malformed acknowledgements and non-202 responses", async () => {
  await assert.rejects(submitIsolatedBuild(job, env, async () => Response.json({ runnerJobId: "../bad" }, { status: 202 })), /invalid job identifier/i);
  await assert.rejects(submitIsolatedBuild(job, env, async () => Response.json({ runnerJobId: "ok" })), /HTTP 202/i);
});
test("reads queued and running states", async () => {
  for (const status of ["queued", "running"] as const) assert.deepEqual(await getIsolatedBuildStatus("runner_job_123", env, async () => Response.json({ status })), { status });
});
test("reads successful and failed terminal results", async () => {
  assert.deepEqual(await getIsolatedBuildStatus("runner_job_123", env, async () => Response.json({ status: "succeeded", result: { status: "succeeded", artifactId: "artifact_123", outputFileCount: 12, outputBytes: 4096 } })),
    { status: "succeeded", result: { status: "succeeded", artifactId: "artifact_123", outputFileCount: 12, outputBytes: 4096 } });
  assert.deepEqual(await getIsolatedBuildStatus("runner_job_123", env, async () => Response.json({ status: "failed", result: { status: "failed", errorCode: "build_failed" } })),
    { status: "failed", result: { status: "failed", errorCode: "build_failed" } });
});
test("rejects unsafe IDs, mismatched terminal status, and unknown statuses", async () => {
  await assert.rejects(getIsolatedBuildStatus("../escape", env), /invalid runner job identifier/i);
  await assert.rejects(getIsolatedBuildStatus("runner_job_123", env, async () => Response.json({ status: "succeeded", result: { status: "failed", errorCode: "build_failed" } })), /do not match/i);
  await assert.rejects(getIsolatedBuildStatus("runner_job_123", env, async () => Response.json({ status: "secret" })), /unsupported job status/i);
});
test("does not contact the runner without server configuration", async () => {
  let called = false;
  await assert.rejects(submitIsolatedBuild(job, {}, async () => { called = true; return Response.json({}); }),
    (error: unknown) => error instanceof AsyncBuildRunnerError && error.code === "not_configured");
  assert.equal(called, false);
});
