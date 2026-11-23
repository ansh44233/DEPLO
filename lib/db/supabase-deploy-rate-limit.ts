type Env = Record<string, string | undefined>;

export type DeploySlot = { allowed: true } | { allowed: false; retryAfterSeconds: number };

const DEFAULT_PER_HOUR = 30;

/** Deploys allowed per account per hour; DEPLO_DEPLOYS_PER_HOUR=0 turns the limit off. */
export function deploysPerHour(env: Env = process.env): number {
  const raw = env.DEPLO_DEPLOYS_PER_HOUR?.trim();
  if (!raw) return DEFAULT_PER_HOUR;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 && value <= 10_000 ? value : DEFAULT_PER_HOUR;
}

/**
 * Takes one deploy slot for the account (migration 0017). Fails open when the
 * database is unreachable or not migrated, so the limit never blocks deploys
 * because of an outage; it logs so the operator can notice.
 */
export async function claimDeploySlot(ownerGithubId: number, env: Env = process.env, fetcher: typeof fetch = fetch): Promise<DeploySlot> {
  const limit = deploysPerHour(env);
  if (limit === 0) return { allowed: true };
  const raw = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!raw || !key || !Number.isSafeInteger(ownerGithubId) || ownerGithubId <= 0) return { allowed: true };
  try {
    const url = new URL("/rest/v1/rpc/claim_deploy_slot", raw);
    const response = await fetcher(url, {
      method: "POST",
      headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ p_owner_github_id: ownerGithubId, p_limit: limit, p_window_seconds: 3600 }),
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      console.error("[deplo] Deploy rate limit unavailable (HTTP " + response.status + "); apply migration 0017.");
      return { allowed: true };
    }
    const wait = await response.json() as unknown;
    if (typeof wait === "number" && Number.isInteger(wait) && wait > 0) return { allowed: false, retryAfterSeconds: Math.min(wait, 3600) };
    return { allowed: true };
  } catch {
    console.error("[deplo] Deploy rate limit unavailable; allowing the deploy.");
    return { allowed: true };
  }
}

export function rateLimitMessage(slot: Extract<DeploySlot, { allowed: false }>): string {
  const minutes = Math.ceil(slot.retryAfterSeconds / 60);
  return "Too many deploys from this account. Try again in " + (minutes <= 1 ? "a minute" : minutes + " minutes") + ".";
}
