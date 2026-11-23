export type GitHubTokenExchange = { clientId: string; clientSecret: string; code: string; redirectUri: string };

/**
 * Exchanges an OAuth authorization code for a user access token.
 * The body is form-encoded, so the Content-Type must say so; GitHub rejects a
 * form body labelled as JSON.
 */
export async function exchangeGitHubCode(
  input: GitHubTokenExchange,
  fetcher: typeof fetch = fetch,
): Promise<{ accessToken: string } | { error: string }> {
  let response: Response;
  try {
    response = await fetcher("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: input.clientId,
        client_secret: input.clientSecret,
        code: input.code,
        redirect_uri: input.redirectUri,
      }).toString(),
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
  } catch {
    return { error: "github_unreachable" };
  }
  if (!response.ok) return { error: "token_http_" + response.status };
  let data: { access_token?: unknown; error?: unknown };
  try { data = await response.json() as typeof data; } catch { return { error: "token_invalid_response" }; }
  if (typeof data.error === "string" && /^[a-z_]{1,64}$/.test(data.error)) return { error: data.error };
  if (typeof data.access_token !== "string" || !data.access_token) return { error: "token_missing" };
  return { accessToken: data.access_token };
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
