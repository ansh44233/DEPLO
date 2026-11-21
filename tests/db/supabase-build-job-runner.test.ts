import test from "node:test";
import assert from "node:assert/strict";
import {
  attachRunnerJob, claimNextBuildJob, claimNextRunnerPollJob, finishBuildJob,
  releaseRunnerPollClaim, saveRunnerArtifact, scheduleRunnerPoll,
} from "../../lib/db/supabase-build-jobs";

const env = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role-secret" };
const row = {
  id: "00000000-0000-4000-8000-000000000001",
  project_id: "00000000-0000-4000-8000-000000000002",
  owner_github_id: 123,
  source_commit_sha: "a".repeat(40),
  framework: "vite",
  package_manager: "pnpm",
  output_directory: "dist",
  status: "processing",
  attempt_count: 1,
  max_attempts: 3,
  available_at: "2026-11-21T00:00:00Z",
  claimed_at: "2026-11-21T00:00:00Z",
  error_code: null,
  created_at: "2026-11-21T00:00:00Z",
  updated_at: "2026-11-21T00:00:00Z",
  runner_job_id: null,
};

function rpcFetcher(payload: unknown, capture: (url: string, body: unknown) => void = () => undefined): typeof fetch {
  return async (url, init) => {
    capture(String(url), init?.body ? JSON.parse(String(init.body)) : {});
    return Response.json(payload);
  };
}

test("claims the next build through the atomic database RPC", async () => {
  let url = "";
  const result = await claimNextBuildJob(env, rpcFetcher([row], (u) => { url = u; }));
  assert.equal(url, "https://example.supabase.co/rest/v1/rpc/claim_next_deplo_build_job");
  assert.equal(result?.id, row.id);
});

test("claims runner polling work through its own atomic RPC", async () => {
  let url = "";
  const result = await claimNextRunnerPollJob(env, rpcFetcher([{ ...row, runner_job_id: "remote_123" }], (u) => { url = u; }));
  assert.equal(url, "https://example.supabase.co/rest/v1/rpc/claim_next_deplo_runner_poll_job");
  assert.equal(result?.runner_job_id, "remote_123");
});

test("attaches the remote job ID with a conditional RPC", async () => {
  let body: unknown;
  const result = await attachRunnerJob(row.id, "remote_123", env, rpcFetcher(true, (_u, b) => { body = b; }));
  assert.equal(result, true);
  assert.deepEqual(body, { p_job_id: row.id, p_runner_job_id: "remote_123" });
});

test("schedules polling, saves artifact metadata, and finishes failed attempts", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetcher = rpcFetcher(null, (url, body) => calls.push({ url, body }));
  await scheduleRunnerPoll(row.id, "running", 10, env, fetcher);
  await saveRunnerArtifact(row.id, { artifactId: "artifact_1", outputFileCount: 4, outputBytes: 2048 }, env, fetcher);
  await finishBuildJob(row.id, "failed", "build_failed", env, fetcher);
  await releaseRunnerPollClaim(row.id, 30, env, fetcher);
  assert.deepEqual(calls.map((c) => c.url.split("/").pop()), [
    "schedule_deplo_runner_poll", "save_deplo_runner_artifact", "finish_deplo_build_job", "release_deplo_runner_poll_claim",
  ]);
  assert.equal((calls[0].body as Record<string, unknown>).p_delay_seconds, 10);
  assert.equal((calls[1].body as Record<string, unknown>).p_artifact_id, "artifact_1");
  assert.equal((calls[2].body as Record<string, unknown>).p_error_code, "build_failed");
});
