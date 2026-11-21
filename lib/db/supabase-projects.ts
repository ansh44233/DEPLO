export type ProjectSourceType = "github" | "zip" | "html";

export type OwnedProject = {
  id: string;
  name: string;
  slug: string;
  source_type: ProjectSourceType;
  repository_url: string | null;
  branch: string | null;
  deployment_url: string | null;
  created_at: string;
  updated_at: string;
};

export type NewOwnedProject = {
  owner_github_id: number;
  name: string;
  slug: string;
  source_type: ProjectSourceType;
  repository_url: string | null;
  branch: string | null;
};

const PROJECT_FIELDS = "id,name,slug,source_type,repository_url,branch,deployment_url,created_at,updated_at";

export class ProjectStoreError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ProjectStoreError";
  }
}

type StoreConfig = { baseUrl: string; serviceKey: string };
type Fetcher = typeof fetch;

function readConfig(env: Record<string, string | undefined>): StoreConfig | null {
  const rawUrl = env.SUPABASE_URL?.trim();
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!rawUrl || !serviceKey) return null;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.hostname !== "localhost") return null;
    return { baseUrl: url.toString().replace(/\/$/, ""), serviceKey };
  } catch {
    return null;
  }
}

function endpoint(config: StoreConfig, query: Record<string, string>): string {
  const url = new URL("/rest/v1/projects", config.baseUrl);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url.toString();
}

async function request<T>(
  url: string,
  config: StoreConfig,
  init: RequestInit,
  fetcher: Fetcher,
): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      headers: {
        apikey: config.serviceKey,
        Authorization: "Bearer " + config.serviceKey,
        "Content-Type": "application/json",
        ...init.headers,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new ProjectStoreError("Project storage is temporarily unavailable.", 502);
  }
  if (response.status === 409) {
    throw new ProjectStoreError("A project with this slug already exists in your workspace.", 409);
  }
  if (!response.ok) {
    throw new ProjectStoreError("Project storage could not complete the request.", 502);
  }
  return await response.json() as T;
}

export async function listOwnedProjects(
  ownerGithubId: number,
  env: Record<string, string | undefined> = process.env,
  fetcher: Fetcher = fetch,
): Promise<OwnedProject[]> {
  const config = readConfig(env);
  if (!config) throw new ProjectStoreError("Account project storage is not configured.", 503);
  const url = endpoint(config, {
    select: PROJECT_FIELDS,
    owner_github_id: "eq." + ownerGithubId,
    order: "updated_at.desc",
    limit: "100",
  });
  return request<OwnedProject[]>(url, config, { method: "GET" }, fetcher);
}

export async function createOwnedProject(
  project: NewOwnedProject,
  env: Record<string, string | undefined> = process.env,
  fetcher: Fetcher = fetch,
): Promise<OwnedProject> {
  const config = readConfig(env);
  if (!config) throw new ProjectStoreError("Account project storage is not configured.", 503);
  const url = endpoint(config, { select: PROJECT_FIELDS });
  const rows = await request<OwnedProject[]>(url, config, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(project),
  }, fetcher);
  if (!Array.isArray(rows) || !rows[0]) {
    throw new ProjectStoreError("Project storage returned an invalid response.", 502);
  }
  return rows[0];
}
