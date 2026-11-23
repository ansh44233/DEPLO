/**
 * Who may sign in to this DEPLO instance.
 *
 * DEPLO publishes sites under the operator's Cloudflare account and runs builds
 * on the operator's Vercel Sandbox quota, so a private instance should name
 * its users. Set DEPLO_ALLOWED_GITHUB_USERS to a comma-separated list of GitHub
 * logins or numeric user IDs (IDs survive renames). Unset means anyone with a
 * GitHub account may sign in, as for a public demo.
 */
type Env = Record<string, string | undefined>;

export function allowedGitHubUsers(env: Env = process.env): { logins: Set<string>; ids: Set<number> } | null {
  const raw = env.DEPLO_ALLOWED_GITHUB_USERS?.trim();
  if (!raw) return null;
  const logins = new Set<string>();
  const ids = new Set<number>();
  for (const part of raw.split(",")) {
    const value = part.trim();
    if (/^\d{1,15}$/.test(value)) ids.add(Number(value));
    else if (/^[A-Za-z0-9-]{1,39}$/.test(value)) logins.add(value.toLowerCase());
  }
  // A list with no valid entry locks everyone out rather than silently opening up.
  return { logins, ids };
}

export function isAllowedGitHubUser(user: { id: number; login: string }, env: Env = process.env): boolean {
  const allowed = allowedGitHubUsers(env);
  if (!allowed) return true;
  return allowed.ids.has(user.id) || allowed.logins.has(user.login.toLowerCase());
}
