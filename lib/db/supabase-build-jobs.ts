export type BuildFramework = "vite" | "react" | "create-react-app" | "nextjs-static";
export type BuildPackageManager = "npm" | "pnpm" | "yarn" | "bun";
export type BuildJobStatus = "pending" | "processing" | "succeeded" | "failed" | "cancelled";
export type OwnedBuildJob = {
  id: string; project_id: string; owner_github_id: number; source_commit_sha: string;
  framework: BuildFramework; package_manager: BuildPackageManager;
  output_directory: "dist" | "build" | "out"; status: BuildJobStatus;
  attempt_count: number; max_attempts: number; available_at: string;
  claimed_at: string | null; error_code: string | null; created_at: string; updated_at: string;
  runner_job_id?: string | null; runner_status?: "queued" | "running" | "succeeded" | null;
  runner_poll_after?: string | null; artifact_id?: string | null;
  artifact_file_count?: number | null; artifact_bytes?: number | null;
  artifact_publish_claimed_at?: string | null;
};
export class BuildJobStoreError extends Error {
  constructor(message: string, public readonly status: number) { super(message); this.name = "BuildJobStoreError"; }
}
type StoreConfig = { baseUrl: string; serviceKey: string };
type Fetcher = typeof fetch;
const FIELDS = "id,project_id,owner_github_id,source_commit_sha,framework,package_manager,output_directory,status,attempt_count,max_attempts,available_at,claimed_at,error_code,created_at,updated_at,runner_job_id,runner_status,runner_poll_after,artifact_id,artifact_file_count,artifact_bytes,artifact_publish_claimed_at";
function readConfig(env: Record<string, string | undefined>): StoreConfig | null {
  const rawUrl = env.SUPABASE_URL?.trim(), serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!rawUrl || !serviceKey) return null;
  try { const url = new URL(rawUrl); if (url.protocol !== "https:" && url.hostname !== "localhost") return null; return { baseUrl: url.toString().replace(/\/$/, ""), serviceKey }; }
  catch { return null; }
}
function tableUrl(config: StoreConfig, query: Record<string, string>): string {
  const url = new URL("/rest/v1/build_jobs", config.baseUrl);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url.toString();
}
async function request<T>(url: string, config: StoreConfig, init: RequestInit, fetcher: Fetcher): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(url, { ...init, headers: { apikey: config.serviceKey, Authorization: "Bearer " + config.serviceKey, "Content-Type": "application/json", ...init.headers }, cache: "no-store", signal: AbortSignal.timeout(8_000) });
  } catch { throw new BuildJobStoreError("Build job storage is temporarily unavailable.", 502); }
  if (response.status === 409) throw new BuildJobStoreError("A matching build job already exists.", 409);
  if (!response.ok) throw new BuildJobStoreError("Build job storage could not complete the request.", 502);
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}
function configured(env: Record<string, string | undefined>) {
  const config = readConfig(env);
  if (!config) throw new BuildJobStoreError("Build job storage is not configured.", 503);
  return config;
}
function rpcUrl(config: StoreConfig, name: string) { return new URL("/rest/v1/rpc/" + name, config.baseUrl).toString(); }

export async function createOwnedBuildJob(
  input: Pick<OwnedBuildJob, "project_id" | "owner_github_id" | "source_commit_sha" | "framework" | "package_manager" | "output_directory">,
  env: Record<string, string | undefined> = process.env, fetcher: Fetcher = fetch,
): Promise<OwnedBuildJob> {
  const config = configured(env);
  const rows = await request<OwnedBuildJob[]>(tableUrl(config, { select: FIELDS }), config, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(input) }, fetcher);
  if (!Array.isArray(rows) || !rows[0]) throw new BuildJobStoreError("Build job storage returned an invalid response.", 502);
  return rows[0];
}
export async function listOwnedBuildJobs(ownerGithubId: number, projectId: string, env: Record<string, string | undefined> = process.env, fetcher: Fetcher = fetch): Promise<OwnedBuildJob[]> {
  const config = configured(env);
  return request<OwnedBuildJob[]>(tableUrl(config, { select: FIELDS, owner_github_id: "eq." + ownerGithubId, project_id: "eq." + projectId, order: "created_at.desc", limit: "50" }), config, { method: "GET" }, fetcher);
}
export async function cancelOwnedBuildJob(ownerGithubId: number, projectId: string, jobId: string, env: Record<string, string | undefined> = process.env, fetcher: Fetcher = fetch): Promise<OwnedBuildJob | null> {
  const config = configured(env);
  const rows = await request<OwnedBuildJob[]>(tableUrl(config, { select: FIELDS, id: "eq." + jobId, project_id: "eq." + projectId, owner_github_id: "eq." + ownerGithubId, status: "in.(pending,processing)" }), config, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ status: "cancelled", updated_at: new Date().toISOString() }) }, fetcher);
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

async function rpc<T>(name: string, body: Record<string, unknown>, env: Record<string, string | undefined>, fetcher: Fetcher): Promise<T> {
  const config = configured(env);
  return request<T>(rpcUrl(config, name), config, { method: "POST", body: JSON.stringify(body) }, fetcher);
}
export async function claimNextBuildJob(env: Record<string, string | undefined> = process.env, fetcher: Fetcher = fetch): Promise<OwnedBuildJob | null> {
  const rows = await rpc<OwnedBuildJob[]>("claim_next_deplo_build_job", {}, env, fetcher);
  return Array.isArray(rows) ? rows[0] ?? null : null;
}
export async function claimNextArtifactPublishJob(env: Record<string, string | undefined> = process.env, fetcher: Fetcher = fetch): Promise<OwnedBuildJob | null> {
  const rows = await rpc<OwnedBuildJob[]>("claim_next_deplo_artifact_publish_job", {}, env, fetcher);
  return Array.isArray(rows) ? rows[0] ?? null : null;
}
export async function claimNextRunnerPollJob(env: Record<string, string | undefined> = process.env, fetcher: Fetcher = fetch): Promise<OwnedBuildJob | null> {
  const rows = await rpc<OwnedBuildJob[]>("claim_next_deplo_runner_poll_job", {}, env, fetcher);
  return Array.isArray(rows) ? rows[0] ?? null : null;
}
export async function attachRunnerJob(jobId: string, runnerJobId: string, env: Record<string, string | undefined> = process.env, fetcher: Fetcher = fetch): Promise<boolean> {
  return rpc<boolean>("attach_deplo_runner_job", { p_job_id: jobId, p_runner_job_id: runnerJobId }, env, fetcher);
}
export async function scheduleRunnerPoll(jobId: string, status: "queued" | "running", delaySeconds: number, env: Record<string, string | undefined> = process.env, fetcher: Fetcher = fetch): Promise<void> {
  await rpc<unknown>("schedule_deplo_runner_poll", { p_job_id: jobId, p_runner_status: status, p_delay_seconds: delaySeconds }, env, fetcher);
}
export async function saveRunnerArtifact(jobId: string, artifact: { artifactId: string; outputFileCount: number; outputBytes: number }, env: Record<string, string | undefined> = process.env, fetcher: Fetcher = fetch): Promise<void> {
  await rpc<unknown>("save_deplo_runner_artifact", { p_job_id: jobId, p_artifact_id: artifact.artifactId, p_output_file_count: artifact.outputFileCount, p_output_bytes: artifact.outputBytes }, env, fetcher);
}
export async function finishBuildJob(jobId: string, status: "succeeded" | "failed", errorCode?: string, env: Record<string, string | undefined> = process.env, fetcher: Fetcher = fetch): Promise<void> {
  await rpc<unknown>("finish_deplo_build_job", { p_job_id: jobId, p_status: status, p_error_code: errorCode ?? null }, env, fetcher);
}
export async function releaseRunnerPollClaim(jobId: string, delaySeconds: number, env: Record<string, string | undefined> = process.env, fetcher: Fetcher = fetch): Promise<void> {
  await rpc<unknown>("release_deplo_runner_poll_claim", { p_job_id: jobId, p_delay_seconds: delaySeconds }, env, fetcher);
}
