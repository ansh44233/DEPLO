import { createSign } from "node:crypto";

const GITHUB_API = "https://api.github.com";

function privateKey(value: string): string {
  return value.replace(/\\n/g, "\n").trim();
}

export function createGitHubAppJwt(appId: string, key: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  if (!/^\d+$/.test(appId) || !key.trim()) throw new Error("GitHub App credentials are not configured.");
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iat: nowSeconds - 60, exp: nowSeconds + 8 * 60, iss: appId })).toString("base64url");
  const unsigned = header + "." + payload;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return unsigned + "." + signer.sign(privateKey(key)).toString("base64url");
}

export async function createInstallationAccessToken(
  installationId: number,
  appId: string,
  key: string,
  fetcher: typeof fetch = fetch,
  /** Names (without owner) of the only repositories the token may read; omit for every repository in the installation. */
  repositories?: readonly string[],
): Promise<string> {
  if (!Number.isSafeInteger(installationId) || installationId <= 0) throw new Error("Invalid GitHub App installation.");
  if (repositories && (repositories.length === 0 || repositories.some((name) => !/^[A-Za-z0-9_.-]{1,100}$/.test(name) || name === "." || name === ".."))) {
    throw new Error("Invalid GitHub repository scope.");
  }
  const jwt = createGitHubAppJwt(appId, key);
  const response = await fetcher(GITHUB_API + "/app/installations/" + installationId + "/access_tokens", {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + jwt,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "DEPLO",
    },
    body: JSON.stringify({ ...(repositories ? { repositories } : {}), permissions: { contents: "read", metadata: "read" } }),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("GitHub App could not issue an installation token.");
  const data = await response.json() as { token?: unknown };
  if (typeof data.token !== "string" || data.token.length < 20) throw new Error("GitHub returned an invalid installation token.");
  return data.token;
}
