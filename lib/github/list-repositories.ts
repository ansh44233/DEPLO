export type RepositorySummary = {
  fullName: string;
  name: string;
  owner: string;
  private: boolean;
  defaultBranch: string;
  description: string | null;
  language: string | null;
  updatedAt: string;
  url: string;
};

type GitHubRepo = {
  full_name?: unknown; name?: unknown; owner?: { login?: unknown }; private?: unknown; default_branch?: unknown;
  description?: unknown; language?: unknown; pushed_at?: unknown; updated_at?: unknown; html_url?: unknown; archived?: unknown;
};

export function toRepositorySummary(repo: GitHubRepo): RepositorySummary | null {
  if (typeof repo.full_name !== "string" || !/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo.full_name)) return null;
  if (typeof repo.html_url !== "string" || !repo.html_url.startsWith("https://github.com/")) return null;
  if (repo.archived === true) return null;
  const [owner, name] = repo.full_name.split("/");
  return {
    fullName: repo.full_name,
    name,
    owner,
    private: repo.private === true,
    defaultBranch: typeof repo.default_branch === "string" ? repo.default_branch : "main",
    description: typeof repo.description === "string" ? repo.description.slice(0, 200) : null,
    language: typeof repo.language === "string" ? repo.language : null,
    updatedAt: typeof repo.pushed_at === "string" ? repo.pushed_at : typeof repo.updated_at === "string" ? repo.updated_at : "",
    url: repo.html_url,
  };
}

/** Lists repositories the signed-in user can access, most recently pushed first (up to 300). */
export async function listUserRepositories(accessToken: string, fetcher: typeof fetch = fetch): Promise<RepositorySummary[]> {
  const results: RepositorySummary[] = [];
  for (let page = 1; page <= 3; page += 1) {
    const response = await fetcher(
      "https://api.github.com/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member&page=" + page,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "DEPLO",
          Authorization: "Bearer " + accessToken,
        },
        signal: AbortSignal.timeout(8_000),
        cache: "no-store",
      },
    );
    if (response.status === 401) throw Object.assign(new Error("Your GitHub sign-in expired. Sign in again."), { status: 401 });
    if (!response.ok) throw Object.assign(new Error("GitHub repositories could not be loaded."), { status: 502 });
    const batch = await response.json() as GitHubRepo[];
    if (!Array.isArray(batch)) break;
    for (const repo of batch) {
      const summary = toRepositorySummary(repo);
      if (summary) results.push(summary);
    }
    if (batch.length < 100) break;
  }
  return results;
}
