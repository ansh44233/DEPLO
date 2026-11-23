import { openSecret, sealSecret } from "../crypto/secret-box";

export type EnvVar = { key: string; value: string };

export const MAX_ENV_VARS = 100;
export const MAX_ENV_VALUE_LENGTH = 8_192;
const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const PURPOSE = "project-env";

export class EnvVarError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "EnvVarError"; }
}

type Env = Record<string, string | undefined>;

function config(env: Env) {
  const baseUrl = env.SUPABASE_URL?.trim().replace(/\/$/, "");
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const secret = env.GITHUB_TOKEN_ENCRYPTION_KEY ?? "";
  if (!baseUrl || !serviceKey) throw new EnvVarError("Project storage is not configured.", 503);
  if (secret.length < 32) throw new EnvVarError("GITHUB_TOKEN_ENCRYPTION_KEY must be set to store environment variables.", 503);
  return { baseUrl, serviceKey, secret };
}

/** Validates and normalises a full set of variables. Later duplicates win, like a .env file. */
export function normaliseEnvVars(input: unknown): EnvVar[] {
  if (!Array.isArray(input)) throw new EnvVarError("Send variables as a list of { key, value }.", 400);
  const byKey = new Map<string, string>();
  for (const item of input) {
    const key = typeof item?.key === "string" ? item.key.trim() : "";
    const value = typeof item?.value === "string" ? item.value : "";
    if (!key) continue;
    if (!KEY_PATTERN.test(key)) throw new EnvVarError("“" + key.slice(0, 40) + "” is not a valid name. Use letters, numbers and underscores, not starting with a number.", 400);
    if (value.length > MAX_ENV_VALUE_LENGTH) throw new EnvVarError(key + " is longer than 8 KB.", 400);
    byKey.set(key, value);
  }
  if (byKey.size > MAX_ENV_VARS) throw new EnvVarError("A project can have up to " + MAX_ENV_VARS + " variables.", 400);
  return [...byKey].map(([key, value]) => ({ key, value })).sort((a, b) => a.key.localeCompare(b.key));
}

/** Parses pasted .env text (KEY=value lines, optional quotes, # comments, optional "export "). */
export function parseDotEnv(text: string): EnvVar[] {
  const result: EnvVar[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"') && value.length >= 2) || (value.startsWith("'") && value.endsWith("'") && value.length >= 2)) {
      value = value.slice(1, -1);
      if (match[2].startsWith('"')) value = value.replace(/\\n/g, "\n");
    } else {
      value = value.replace(/\s+#.*$/, "");
    }
    result.push({ key: match[1], value });
  }
  return result;
}

async function call(url: string, init: RequestInit, cfg: ReturnType<typeof config>, fetcher: typeof fetch): Promise<Response> {
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      headers: { apikey: cfg.serviceKey, Authorization: "Bearer " + cfg.serviceKey, "Content-Type": "application/json", ...init.headers },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new EnvVarError("Project storage is temporarily unavailable.", 502);
  }
  if (response.status === 404 || response.status === 400) {
    const text = await response.text().catch(() => "");
    if (/project_env_vars/.test(text)) throw new EnvVarError("Environment variables need database migration 0013. Run supabase/migrations/0013_project_environment_variables.sql in Supabase.", 503);
  }
  if (!response.ok) throw new EnvVarError("Environment variables could not be saved.", 502);
  return response;
}

export async function listProjectEnvVars(ownerGithubId: number, projectId: string, env: Env = process.env, fetcher: typeof fetch = fetch): Promise<EnvVar[]> {
  const cfg = config(env);
  const url = new URL(cfg.baseUrl + "/rest/v1/project_env_vars");
  url.searchParams.set("select", "key,value_encrypted");
  url.searchParams.set("project_id", "eq." + projectId);
  url.searchParams.set("owner_github_id", "eq." + ownerGithubId);
  url.searchParams.set("order", "key.asc");
  const rows = await (await call(url.toString(), { method: "GET" }, cfg, fetcher)).json() as { key: string; value_encrypted: string }[];
  return rows.map((row) => ({ key: row.key, value: openSecret(row.value_encrypted, cfg.secret, PURPOSE + ":" + projectId) ?? "" }));
}

/** Replaces the project's whole variable set. The caller must already have verified project ownership. */
export async function replaceProjectEnvVars(ownerGithubId: number, projectId: string, variables: EnvVar[], env: Env = process.env, fetcher: typeof fetch = fetch): Promise<EnvVar[]> {
  const cfg = config(env);
  const table = cfg.baseUrl + "/rest/v1/project_env_vars";
  const scope = "project_id=eq." + encodeURIComponent(projectId) + "&owner_github_id=eq." + ownerGithubId;
  const keep = variables.map((item) => item.key);
  // Delete variables that are no longer in the set.
  const removeQuery = keep.length ? "&key=not.in.(" + keep.map((key) => '"' + key + '"').join(",") + ")" : "";
  await call(table + "?" + scope + removeQuery, { method: "DELETE", headers: { Prefer: "return=minimal" } }, cfg, fetcher);
  if (variables.length) {
    const now = new Date().toISOString();
    await call(table + "?on_conflict=project_id,key", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(variables.map((item) => ({
        project_id: projectId,
        owner_github_id: ownerGithubId,
        key: item.key,
        value_encrypted: sealSecret(item.value, cfg.secret, PURPOSE + ":" + projectId),
        updated_at: now,
      }))),
    }, cfg, fetcher);
  }
  return variables;
}

/** Variables as a plain object for a build, or {} when none are set or storage is not migrated yet. */
export async function loadBuildEnv(ownerGithubId: number, projectId: string, env: Env = process.env, fetcher: typeof fetch = fetch): Promise<Record<string, string>> {
  try {
    const variables = await listProjectEnvVars(ownerGithubId, projectId, env, fetcher);
    return Object.fromEntries(variables.map((item) => [item.key, item.value]));
  } catch (error) {
    if (error instanceof EnvVarError && error.status === 503) return {};
    throw error;
  }
}
