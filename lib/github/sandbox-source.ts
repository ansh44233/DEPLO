import { createInstallationAccessToken } from "./app-auth";
import { getActiveGitHubInstallationId } from "../db/supabase-github-app-installations";

/**
 * How a dashboard build gets the repository into the sandbox.
 *
 * The sandbox runs the repository's own install and build scripts, so a
 * dependency could read any credential placed there. A signed-in user's OAuth
 * token can read and write every repository they own, so it never goes in:
 * - public repositories are cloned without a token,
 * - private repositories are cloned with a GitHub App installation token
 *   limited to that one repository, read-only, expiring within an hour,
 * - otherwise the archive DEPLO already downloaded on the server is copied in.
 */
export type SandboxSource =
  | { kind: "clone"; repositoryUrl: string; accessToken: string | null; reason: "public" | "app-token" }
  | { kind: "copy"; reason: "private-without-app" | "visibility-unknown" };

type Env = Record<string, string | undefined>;

export async function chooseSandboxSource(input: {
  owner: string;
  repository: string;
  ownerGithubId: number;
  /** The signed-in user's token; used only server-side, to read repository visibility. */
  userToken: string | null;
  env?: Env;
  fetcher?: typeof fetch;
}): Promise<SandboxSource> {
  const env = input.env ?? process.env;
  const fetcher = input.fetcher ?? fetch;
  const repositoryUrl = "https://github.com/" + input.owner + "/" + input.repository + ".git";

  let visibility: "public" | "private" | "unknown" = "unknown";
  try {
    const response = await fetcher(
      "https://api.github.com/repos/" + encodeURIComponent(input.owner) + "/" + encodeURIComponent(input.repository),
      {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "DEPLO",
          ...(input.userToken ? { Authorization: "Bearer " + input.userToken } : {}),
        },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (response.ok) {
      const data = await response.json() as { private?: unknown; visibility?: unknown };
      visibility = data.private === false && data.visibility !== "internal" ? "public" : "private";
    }
  } catch {
    visibility = "unknown";
  }
  if (visibility === "public") return { kind: "clone", repositoryUrl, accessToken: null, reason: "public" };

  const appId = env.GITHUB_APP_ID?.trim() ?? "";
  const privateKey = env.GITHUB_APP_PRIVATE_KEY?.trim() ?? "";
  if (appId && privateKey) {
    try {
      const installationId = await getActiveGitHubInstallationId(input.ownerGithubId, env, fetcher);
      if (installationId !== null) {
        const token = await createInstallationAccessToken(installationId, appId, privateKey, fetcher, [input.repository]);
        return { kind: "clone", repositoryUrl, accessToken: token, reason: "app-token" };
      }
    } catch {
      // The App may not cover this repository (for example one owned by an organization); copy instead.
    }
  }
  return { kind: "copy", reason: visibility === "unknown" ? "visibility-unknown" : "private-without-app" };
}
