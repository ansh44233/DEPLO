import test from "node:test";
import assert from "node:assert/strict";
import { BuildRunnerError, dispatchIsolatedBuild } from "../../lib/deploy/isolated-build-runner";

const env = {
  DEPLO_BUILD_RUNNER_URL: "https://runner.example/build",
  DEPLO_BUILD_RUNNER_TOKEN: "r".repeat(48),
};
const job = {
  jobId: "00000000-0000-4000-8000-000000000001",
  sourceId: "source_123",
  sourceCommitSha: "a".repeat(40),
  framework: "vite" as const,
  packageManager: "pnpm" as const,
  outputDirectory: "dist" as const,
};

test("dispatches only the bounded build contract to the isolated runner", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const fetcher: typeof fetch = async (url, init) => {
    capturedUrl = String(url);
    capturedInit = init;
    return Response.json({ status: "succeeded", artifactId: "artifact_123", outputFileCount: 24, outputBytes: 8192 });
  };
  const result = await dispatchIsolatedBuild(job, env, fetcher);
  assert.equal(capturedUrl, env.DEPLO_BUILD_RUNNER_URL);
  assert.equal((capturedInit?.headers as Record<string, string>).Authorization, "Bearer " + env.DEPLO_BUILD_RUNNER_TOKEN);
  assert.equal(capturedInit?.redirect, "error");
  assert.equal(capturedInit?.credentials, "omit");
  const body = JSON.parse(String(capturedInit?.body));
  assert.equal(body.sourceCommitSha, job.sourceCommitSha);
  assert.equal(body.sourceId, job.sourceId);
  assert.equal(body.limits.networkPolicy, "deny-by-default");
  assert.deepEqual(result, { status: "succeeded", artifactId: "artifact_123", outputFileCount: 24, outputBytes: 8192 });
});

test("never dispatches when runner configuration is missing", async () => {
  let called = false;
  await assert.rejects(
    dispatchIsolatedBuild(job, {}, async () => { called = true; return Response.json({}); }),
    (error: unknown) => error instanceof BuildRunnerError && error.code === "not_configured",
  );
  assert.equal(called, false);
});

test("rejects untrusted artifact metadata from the runner", async () => {
  const fetcher: typeof fetch = async () => Response.json({
    status: "succeeded", artifactId: "../escape", outputFileCount: 1, outputBytes: 20,
  });
  await assert.rejects(dispatchIsolatedBuild(job, env, fetcher), /invalid artifact metadata/i);
});

test("rejects oversized artifact claims and unknown result codes", async () => {
  const oversized: typeof fetch = async () => Response.json({
    status: "succeeded", artifactId: "artifact", outputFileCount: 5001, outputBytes: 10,
  });
  await assert.rejects(dispatchIsolatedBuild(job, env, oversized), /invalid artifact metadata/i);
  const unknown: typeof fetch = async () => Response.json({ status: "failed", errorCode: "secret_leaked" });
  await assert.rejects(dispatchIsolatedBuild(job, env, unknown), /unsupported result/i);
});

test("does not follow redirects that could forward runner authorization", async () => {
  const fetcher: typeof fetch = async (_url, init) => {
    assert.equal(init?.redirect, "error");
    return new Response(null, { status: 302, headers: { location: "https://elsewhere.example" } });
  };
  await assert.rejects(dispatchIsolatedBuild(job, env, fetcher), (error: unknown) =>
    error instanceof BuildRunnerError && error.code === "rejected");
});

test("rejects non-JSON and oversized responses", async () => {
  await assert.rejects(dispatchIsolatedBuild(job, env, async () => new Response("no", {
    headers: { "content-type": "text/plain" },
  })), /unexpected content type/i);
  const huge = " ".repeat(17 * 1024);
  await assert.rejects(dispatchIsolatedBuild(job, env, async () => new Response(huge, {
    headers: { "content-type": "application/json" },
  })), /exceeded the allowed size/i);
});
