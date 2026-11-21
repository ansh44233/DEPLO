import test from "node:test";
import assert from "node:assert/strict";
import { cancelOwnedBuildJob, claimNextArtifactPublishJob, createOwnedBuildJob, listOwnedBuildJobs, type OwnedBuildJob } from "../../lib/db/supabase-build-jobs";

const env = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "server-only-secret" };
const job: OwnedBuildJob = {
  id: "00000000-0000-4000-8000-000000000002", project_id: "00000000-0000-4000-8000-000000000001",
  owner_github_id: 12345, source_commit_sha: "a".repeat(40), framework: "vite",
  package_manager: "pnpm", output_directory: "dist", status: "pending", attempt_count: 0,
  max_attempts: 3, available_at: "2026-11-21T00:00:00.000Z", claimed_at: null,
  error_code: null, created_at: "2026-11-21T00:00:00.000Z", updated_at: "2026-11-21T00:00:00.000Z",
};

test("creates a build job with server-derived account ownership", async () => {
  let body = "";
  const fetcher: typeof fetch = async (_url, init) => { body = String(init?.body); return new Response(JSON.stringify([job]), { status: 201 }); };
  const result = await createOwnedBuildJob({
    project_id: job.project_id, owner_github_id: 12345, source_commit_sha: job.source_commit_sha,
    framework: "vite", package_manager: "pnpm", output_directory: "dist",
  }, env, fetcher);
  assert.equal(result.id, job.id);
  assert.equal(JSON.parse(body).owner_github_id, 12345);
});

test("lists build jobs constrained by project and authenticated owner", async () => {
  let requested = "";
  const fetcher: typeof fetch = async (url) => { requested = String(url); return new Response(JSON.stringify([job])); };
  const rows = await listOwnedBuildJobs(12345, job.project_id, env, fetcher);
  const url = new URL(requested);
  assert.equal(url.searchParams.get("owner_github_id"), "eq.12345");
  assert.equal(url.searchParams.get("project_id"), "eq." + job.project_id);
  assert.deepEqual(rows, [job]);
});

test("cancels only pending or processing jobs belonging to the account and project", async () => {
  let requested = "";
  let body = "";
  const fetcher: typeof fetch = async (url, init) => { requested = String(url); body = String(init?.body); return new Response(JSON.stringify([{ ...job, status: "cancelled" }])); };
  const result = await cancelOwnedBuildJob(12345, job.project_id, job.id, env, fetcher);
  const url = new URL(requested);
  assert.equal(url.searchParams.get("owner_github_id"), "eq.12345");
  assert.equal(url.searchParams.get("project_id"), "eq." + job.project_id);
  assert.equal(url.searchParams.get("status"), "in.(pending,processing)");
  assert.equal(JSON.parse(body).status, "cancelled");
  assert.equal(result?.status, "cancelled");
});

test("claims a durable artifact publication job through the service-only RPC", async () => {
  let requested = "";
  let method = "";
  const fetcher: typeof fetch = async (url, init) => {
    requested = String(url);
    method = init?.method ?? "";
    return new Response(JSON.stringify([{ ...job, runner_status: "succeeded", artifact_id: "artifact_123", artifact_file_count: 1, artifact_bytes: 42 }]));
  };
  const result = await claimNextArtifactPublishJob(env, fetcher);
  assert.equal(new URL(requested).pathname, "/rest/v1/rpc/claim_next_deplo_artifact_publish_job");
  assert.equal(method, "POST");
  assert.equal(result?.artifact_id, "artifact_123");
});

test("rejects missing Supabase configuration", async () => {
  await assert.rejects(createOwnedBuildJob({
    project_id: job.project_id, owner_github_id: 12345, source_commit_sha: job.source_commit_sha,
    framework: "vite", package_manager: "pnpm", output_directory: "dist",
  }, {}), /not configured/);
});
