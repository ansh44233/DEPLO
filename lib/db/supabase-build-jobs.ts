export type BuildFramework = "vite" | "react" | "create-react-app" | "nextjs-static";
export type BuildPackageManager = "npm" | "pnpm" | "yarn" | "bun";
export type BuildJobStatus = "pending" | "processing" | "succeeded" | "failed" | "cancelled";
export type OwnedBuildJob = {
  id: string; project_id: string; owner_github_id: number; source_commit_sha: string;
  framework: BuildFramework; package_manager: BuildPackageManager;
  output_directory: "dist" | "build" | "out"; status: BuildJobStatus;
  attempt_count: number; max_attempts: number; available_at: string;
  claimed_at: string | null; error_code: string | null; created_at: string; updated_at: string;
};
export class BuildJobStoreError extends Error {
  constructor(message: string, public readonly status: number) { super(message); this.name = "BuildJobStoreError"; }
}
type StoreConfig = { baseUrl: string; serviceKey: string };
type Fetcher = typeof fetch;
const FIELDS = "id,project_id,owner_github_id,source_commit_sha,framework,package_manager,output_directory,status,attempt_count,max_attempts,available_at,claimed_at,error_code,created_at,updated_at";
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
