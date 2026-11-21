export class GitHubInstallationStoreError extends Error {
  constructor(message: string, public readonly status: number) { super(message); this.name = "GitHubInstallationStoreError"; }
}

export async function getActiveGitHubInstallationId(
  ownerGithubId: number,
  env: Record<string, string | undefined> = process.env,
  fetcher: typeof fetch = fetch,
): Promise<number | null> {
  const rawUrl = env.SUPABASE_URL?.trim();
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!rawUrl || !serviceKey) throw new GitHubInstallationStoreError("GitHub installation storage is not configured.", 503);
  let baseUrl: string;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") throw new Error("Unsafe storage URL.");
    baseUrl = parsed.toString().replace(/\/$/, "");
  } catch { throw new GitHubInstallationStoreError("GitHub installation storage is not configured.", 503); }
  const url = new URL("/rest/v1/github_app_installations", baseUrl);
  url.searchParams.set("select", "installation_id");
  url.searchParams.set("owner_github_id", "eq." + ownerGithubId);
  url.searchParams.set("suspended_at", "is.null");
  url.searchParams.set("limit", "1");
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "GET",
      headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey, Accept: "application/json" },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8_000),
    });
  } catch { throw new GitHubInstallationStoreError("GitHub installation storage is temporarily unavailable.", 502); }
  if (!response.ok) throw new GitHubInstallationStoreError("GitHub installation storage is temporarily unavailable.", 502);
  const rows = await response.json() as Array<{ installation_id?: unknown }>;
  const id = rows[0]?.installation_id;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : null;
}
