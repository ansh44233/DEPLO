import type { GitHubCredentials } from "./github-token";

export type GitHubTokenExchange = { clientId: string; clientSecret: string; code: string; redirectUri: string };

type TokenResult = GitHubCredentials | { error: string };

/**
 * Posts to GitHub's token endpoint. The body is form-encoded, so the
 * Content-Type must say so; GitHub rejects a form body labelled as JSON.
 */
async function requestToken(fields: Record<string, string>, fetcher: typeof fetch, nowSeconds: number): Promise<TokenResult> {
  let response: Response;
  try {
    response = await fetcher("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
  } catch {
    return { error: "github_unreachable" };
  }
  if (!response.ok) return { error: "token_http_" + response.status };
  let data: { access_token?: unknown; error?: unknown; refresh_token?: unknown; expires_in?: unknown; refresh_token_expires_in?: unknown };
  try { data = await response.json() as typeof data; } catch { return { error: "token_invalid_response" }; }
  if (typeof data.error === "string" && /^[a-z_]{1,64}$/.test(data.error)) return { error: data.error };
  if (typeof data.access_token !== "string" || !data.access_token || data.access_token.length > 4096) return { error: "token_missing" };
  const seconds = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? nowSeconds + value : null;
  const refreshToken = typeof data.refresh_token === "string" && data.refresh_token && data.refresh_token.length <= 4096 ? data.refresh_token : null;
  return {
    accessToken: data.access_token,
    refreshToken,
    expiresAt: seconds(data.expires_in),
    refreshExpiresAt: refreshToken ? seconds(data.refresh_token_expires_in) : null,
  };
}

/** Exchanges an authorization code for user credentials (OAuth App or GitHub App sign-in). */
export async function exchangeGitHubCode(
  input: GitHubTokenExchange,
  fetcher: typeof fetch = fetch,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<TokenResult> {
  return requestToken({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    redirect_uri: input.redirectUri,
  }, fetcher, nowSeconds);
}

/**
 * Exchanges a GitHub App refresh token for new credentials. GitHub App user
 * tokens expire after 8 hours; each refresh token works once.
 */
export async function refreshGitHubCredentials(
  input: { clientId: string; clientSecret: string; refreshToken: string },
  fetcher: typeof fetch = fetch,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<TokenResult> {
  if (!input.clientId || !input.clientSecret || !input.refreshToken) return { error: "refresh_not_configured" };
  return requestToken({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
  }, fetcher, nowSeconds);
}

/**
 * Revokes one OAuth access token at GitHub (used at sign-out), so a copied
 * token cookie stops working too. Other sign-ins of the same user keep theirs.
 */
export async function revokeGitHubToken(
  input: { clientId: string; clientSecret: string; accessToken: string },
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  if (!input.clientId || !input.clientSecret || !input.accessToken) return false;
  try {
    const response = await fetcher("https://api.github.com/applications/" + encodeURIComponent(input.clientId) + "/token", {
      method: "DELETE",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Basic " + Buffer.from(input.clientId + ":" + input.clientSecret).toString("base64"),
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "DEPLO",
      },
      body: JSON.stringify({ access_token: input.accessToken }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    // 204: revoked. 404: already invalid. Either way the token no longer works.
    return response.status === 204 || response.status === 404;
  } catch {
    return false;
  }
}
