import { SESSION_ID_PATTERN } from "../auth/session";

type Env = Record<string, string | undefined>;

function config(env: Env): { table: string; headers: Record<string, string> } | null {
  const raw = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!raw || !key) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.hostname !== "localhost") return null;
    return {
      table: url.origin + "/rest/v1/revoked_sessions",
      headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json", Accept: "application/json" },
    };
  } catch {
    return null;
  }
}

/** Revoked IDs are remembered for this process's lifetime; unrevoked lookups for a short while. */
const revokedCache = new Set<string>();
const activeCache = new Map<string, number>();
const ACTIVE_CACHE_MS = 15_000;
const MAX_CACHE_ENTRIES = 5_000;

export function clearSessionRevocationCache(): void {
  revokedCache.clear();
  activeCache.clear();
}

/**
 * Records a sign-out. Throws when storage is unreachable so the caller can tell
 * the user the sign-out did not reach every device.
 */
export async function revokeSession(
  sid: string,
  ownerGithubId: number,
  expiresAtSeconds: number,
  env: Env = process.env,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (!SESSION_ID_PATTERN.test(sid) || !Number.isSafeInteger(ownerGithubId) || ownerGithubId <= 0) throw new Error("Invalid session.");
  const cfg = config(env);
  if (!cfg) throw new Error("Session storage is not configured.");
  revokedCache.add(sid);
  activeCache.delete(sid);
  const response = await fetcher(cfg.table + "?on_conflict=sid", {
    method: "POST",
    headers: { ...cfg.headers, Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({ sid, owner_github_id: ownerGithubId, expires_at: new Date(expiresAtSeconds * 1000).toISOString() }),
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("Session revocation could not be saved.");
  // Housekeeping: drop rows for sessions that have expired anyway.
  await fetcher(cfg.table + "?expires_at=lt." + encodeURIComponent(new Date().toISOString()), {
    method: "DELETE",
    headers: { ...cfg.headers, Prefer: "return=minimal" },
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  }).catch(() => undefined);
}

/**
 * Whether a sign-in was ended. Fails open (returns false) when storage is
 * unreachable or not migrated, so an outage cannot lock every user out; the
 * session's own 7-day expiry still applies.
 */
export async function isSessionRevoked(sid: string, env: Env = process.env, fetcher: typeof fetch = fetch, now = Date.now()): Promise<boolean> {
  if (!SESSION_ID_PATTERN.test(sid)) return false;
  if (revokedCache.has(sid)) return true;
  const checked = activeCache.get(sid);
  if (checked !== undefined && now - checked < ACTIVE_CACHE_MS) return false;
  const cfg = config(env);
  if (!cfg) return false;
  try {
    const url = new URL(cfg.table);
    url.searchParams.set("select", "sid");
    url.searchParams.set("sid", "eq." + sid);
    url.searchParams.set("limit", "1");
    const response = await fetcher(url, { headers: cfg.headers, cache: "no-store", signal: AbortSignal.timeout(2_000) });
    if (!response.ok) return false;
    const rows = await response.json() as unknown[];
    if (Array.isArray(rows) && rows.length > 0) {
      if (revokedCache.size >= MAX_CACHE_ENTRIES) revokedCache.clear();
      revokedCache.add(sid);
      return true;
    }
    if (activeCache.size >= MAX_CACHE_ENTRIES) activeCache.clear();
    activeCache.set(sid, now);
    return false;
  } catch {
    return false;
  }
}
