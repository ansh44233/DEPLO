/**
 * Which kind of GitHub app "Sign in with GitHub" uses.
 *
 * - "app": GITHUB_CLIENT_ID belongs to the GitHub App (client IDs start with
 *   "Iv"). Users grant only what the App is allowed, only on repositories
 *   where it is installed, and tokens expire after 8 hours (refreshed
 *   automatically). Recommended.
 * - "oauth": a classic OAuth App, which needs the `repo` scope to see private
 *   repositories: full read and write access to every one of them.
 *
 * DEPLO_GITHUB_SIGN_IN=app|oauth overrides the detection.
 */
export type GitHubSignInMode = "app" | "oauth";

export function githubSignInMode(env: Record<string, string | undefined> = process.env): GitHubSignInMode {
  const explicit = env.DEPLO_GITHUB_SIGN_IN?.trim().toLowerCase();
  if (explicit === "app" || explicit === "oauth") return explicit;
  return /^Iv/.test(env.GITHUB_CLIENT_ID?.trim() ?? "") ? "app" : "oauth";
}

/** OAuth scopes to request. GitHub Apps ignore scopes; their permissions come from the App settings. */
export function githubSignInScope(mode: GitHubSignInMode): string | null {
  return mode === "app" ? null : "read:user repo";
}
