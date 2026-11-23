import { CACHE_KEY_PATTERN, SNAPSHOT_ID_PATTERN, type BuildCacheEntry, type BuildCacheStore } from "../deploy/build-cache";

type Env = Record<string, string | undefined>;

/**
 * Stores a project's dependency-cache snapshot in Supabase (migration 0015).
 * Every failure, including a database that has not been migrated yet, just
 * means "no cache": builds never fail because of the cache.
 *
 * Pass `readOnly` for builds of untrusted code, such as pull request previews,
 * so they can use the production cache but never replace it.
 */
export function supabaseBuildCache(
  ownerGithubId: number,
  projectId: string,
  options: { readOnly?: boolean } = {},
  env: Env = process.env,
  fetcher: typeof fetch = fetch,
): BuildCacheStore | null {
  const baseUrl = env.SUPABASE_URL?.trim().replace(/\/$/, "");
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!baseUrl || !serviceKey || env.DEPLO_DISABLE_BUILD_CACHE === "1") return null;
  if (!Number.isSafeInteger(ownerGithubId) || ownerGithubId <= 0) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)) return null;

  const table = baseUrl + "/rest/v1/project_build_caches";
  const headers = { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json" };

  const store: BuildCacheStore = {
    async load(): Promise<BuildCacheEntry | null> {
      const url = new URL(table);
      url.searchParams.set("select", "cache_key,snapshot_id");
      url.searchParams.set("project_id", "eq." + projectId);
      url.searchParams.set("owner_github_id", "eq." + ownerGithubId);
      url.searchParams.set("limit", "1");
      try {
        const response = await fetcher(url.toString(), { headers, cache: "no-store", signal: AbortSignal.timeout(5_000) });
        if (!response.ok) return null;
        const rows = await response.json() as { cache_key?: unknown; snapshot_id?: unknown }[];
        const row = Array.isArray(rows) ? rows[0] : undefined;
        if (typeof row?.cache_key !== "string" || typeof row.snapshot_id !== "string") return null;
        if (!CACHE_KEY_PATTERN.test(row.cache_key) || !SNAPSHOT_ID_PATTERN.test(row.snapshot_id)) return null;
        return { key: row.cache_key, snapshotId: row.snapshot_id };
      } catch {
        return null;
      }
    },
  };
  if (!options.readOnly) {
    store.save = async (entry: BuildCacheEntry): Promise<void> => {
      if (!CACHE_KEY_PATTERN.test(entry.key) || !SNAPSHOT_ID_PATTERN.test(entry.snapshotId)) return;
      try {
        await fetcher(table + "?on_conflict=project_id", {
          method: "POST",
          headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({
            project_id: projectId,
            owner_github_id: ownerGithubId,
            cache_key: entry.key,
            snapshot_id: entry.snapshotId,
            updated_at: new Date().toISOString(),
          }),
          cache: "no-store",
          signal: AbortSignal.timeout(5_000),
        });
      } catch {
        // A lost save only costs the next build its cache.
      }
    };
  }
  return store;
}
