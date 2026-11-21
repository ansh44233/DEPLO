import test from "node:test";
import assert from "node:assert/strict";
import { createIsolatedBuildRequest, readBuildRunnerConfiguration } from "../../lib/deploy/build-runner-contract";

const job = {
  jobId: "00000000-0000-4000-8000-000000000001",
  sourceCommitSha: "a".repeat(40),
  framework: "vite" as const,
  packageManager: "pnpm" as const,
  outputDirectory: "dist" as const,
};

test("creates a bounded isolated build request with network denied by default", () => {
  const request = createIsolatedBuildRequest(job);
  assert.equal(request.limits.timeoutSeconds, 600);
  assert.equal(request.limits.memoryMiB, 2048);
  assert.equal(request.limits.cpuMillicores, 2000);
  assert.equal(request.limits.networkPolicy, "deny-by-default");
  assert.equal(request.limits.maxOutputBytes, 100 * 1024 * 1024);
});

test("rejects malformed commit identifiers and mismatched output directories", () => {
  assert.throws(() => createIsolatedBuildRequest({ ...job, sourceCommitSha: "main" }), /commit SHA/);
  assert.throws(() => createIsolatedBuildRequest({ ...job, outputDirectory: "out" as "dist" }), /does not match/);
});

test("requires a server-only HTTPS runner endpoint and a strong token", () => {
  assert.equal(readBuildRunnerConfiguration({ DEPLO_BUILD_RUNNER_URL: "http://runner.example", DEPLO_BUILD_RUNNER_TOKEN: "x".repeat(40) }), null);
  assert.equal(readBuildRunnerConfiguration({ DEPLO_BUILD_RUNNER_URL: "https://runner.example", DEPLO_BUILD_RUNNER_TOKEN: "short" }), null);
  const config = readBuildRunnerConfiguration({ DEPLO_BUILD_RUNNER_URL: "https://runner.example/build", DEPLO_BUILD_RUNNER_TOKEN: "x".repeat(40) });
  assert.equal(config?.endpoint.href, "https://runner.example/build");
  assert.equal(config?.token, "x".repeat(40));
});

test("rejects runner URLs containing credentials, query strings, or fragments", () => {
  for (const url of ["https://user:pass@runner.example/build", "https://runner.example/build?debug=1", "https://runner.example/build#fragment"]) {
    assert.equal(readBuildRunnerConfiguration({ DEPLO_BUILD_RUNNER_URL: url, DEPLO_BUILD_RUNNER_TOKEN: "x".repeat(40) }), null);
  }
});
