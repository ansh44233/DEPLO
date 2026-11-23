/**
 * Resolves a branch to its current commit, so one deploy downloads, builds and
 * reports exactly one commit even if someone pushes while it runs.
 * Returns null when GitHub cannot say; callers then fall back to the branch name.
 */
export async function resolveBranchHead(
  input: { owner: string; repository: string; branch: string; token: string | null },
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const response = await fetcher(
      "https://api.github.com/repos/" + encodeURIComponent(input.owner) + "/" + encodeURIComponent(input.repository) +
        "/commits/" + input.branch.split("/").map(encodeURIComponent).join("/"),
      {
        headers: {
          Accept: "application/vnd.github.sha",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "DEPLO",
          ...(input.token ? { Authorization: "Bearer " + input.token } : {}),
        },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!response.ok) return null;
    const sha = (await response.text()).trim();
    return /^[a-f0-9]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}
