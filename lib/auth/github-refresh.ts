import { refreshGitHubCredentials } from "./github-oauth";
import { decryptGitHubCredentials, encryptGitHubCredentials, type GitHubCredentials } from "./github-token";

type Env = Record<string, string | undefined>;

/** Refresh this long before the access token expires, so a request never starts with one about to lapse. */
const REFRESH_MARGIN_SECONDS = 5 * 60;

// A refresh token works once; requests that arrive together share one refresh.
const inFlight = new Map<string, Promise<GitHubCredentials | null>>();

/**
 * Refreshes GitHub App user credentials stored in the token cookie when the
 * access token is about to expire. Returns the new encrypted cookie value, or
 * null when nothing changed (not expiring, not refreshable, or refresh failed;
 * in that last case GitHub calls fail with 401 and the user signs in again).
 */
export async function refreshGitHubCookieIfNeeded(
  cookieValue: string | undefined,
  env: Env = process.env,
  fetcher: typeof fetch = fetch,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string | null> {
  const secret = env.GITHUB_TOKEN_ENCRYPTION_KEY ?? "";
  const credentials = decryptGitHubCredentials(cookieValue, secret);
  if (!credentials?.refreshToken || credentials.expiresAt === null) return null;
  if (credentials.expiresAt - nowSeconds > REFRESH_MARGIN_SECONDS) return null;
  if (credentials.refreshExpiresAt !== null && credentials.refreshExpiresAt <= nowSeconds) return null;

  const key = credentials.refreshToken;
  let pending = inFlight.get(key);
  if (!pending) {
    pending = refreshGitHubCredentials({
      clientId: env.GITHUB_CLIENT_ID?.trim() ?? "",
      clientSecret: env.GITHUB_CLIENT_SECRET?.trim() ?? "",
      refreshToken: key,
    }, fetcher, nowSeconds).then((result) => ("error" in result ? null : result));
    inFlight.set(key, pending);
    // Keep the result briefly for requests that arrive just after; unref so it never holds the process open.
    pending.finally(() => { setTimeout(() => inFlight.delete(key), 30_000).unref?.(); }).catch(() => undefined);
  }
  const refreshed = await pending.catch(() => null);
  if (!refreshed) return null;
  try {
    return encryptGitHubCredentials(refreshed, secret);
  } catch {
    return null;
  }
}
