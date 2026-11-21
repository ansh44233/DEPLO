const MAX_SOURCE_ARCHIVE_BYTES = 25 * 1024 * 1024;

export class GitHubSourceArchiveError extends Error {
  constructor(message: string, public readonly code: "unavailable" | "too_large" | "invalid_archive" | "invalid_source") {
    super(message); this.name = "GitHubSourceArchiveError";
  }
}

export async function downloadGitHubSourceArchive(
  repository: { owner: string; repository: string },
  commitSha: string,
  installationToken: string,
  fetcher: typeof fetch = fetch,
): Promise<Uint8Array> {
  if (!/^[a-f0-9]{40}$/.test(commitSha) || !/^[a-zA-Z0-9-]{1,39}$/.test(repository.owner) ||
      !/^[a-zA-Z0-9_.-]{1,100}$/.test(repository.repository) || !installationToken) {
    throw new GitHubSourceArchiveError("Invalid GitHub source request.", "invalid_source");
  }
  const url = "https://api.github.com/repos/" + encodeURIComponent(repository.owner) + "/" +
    encodeURIComponent(repository.repository) + "/zipball/" + commitSha;
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json", Authorization: "Bearer " + installationToken,
        "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "DEPLO",
      },
      cache: "no-store", credentials: "omit", redirect: "follow", signal: AbortSignal.timeout(30_000),
    });
  } catch { throw new GitHubSourceArchiveError("GitHub could not provide the requested source archive.", "unavailable"); }
  let finalUrl: URL;
  try { finalUrl = new URL(response.url || url); }
  catch { throw new GitHubSourceArchiveError("GitHub returned an invalid archive location.", "invalid_source"); }
  if (finalUrl.protocol !== "https:" || !["api.github.com", "codeload.github.com"].includes(finalUrl.hostname)) {
    throw new GitHubSourceArchiveError("GitHub redirected the source archive to an untrusted host.", "invalid_source");
  }
  if (response.status === 404) throw new GitHubSourceArchiveError("The selected repository or commit is unavailable to the linked GitHub App.", "unavailable");
  if (!response.ok || !response.body) throw new GitHubSourceArchiveError("GitHub could not provide the requested source archive.", "unavailable");
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_SOURCE_ARCHIVE_BYTES) {
    await response.body.cancel().catch(() => undefined);
    throw new GitHubSourceArchiveError("The repository source archive exceeds 25 MiB.", "too_large");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_SOURCE_ARCHIVE_BYTES) {
        await reader.cancel();
        throw new GitHubSourceArchiveError("The repository source archive exceeds 25 MiB.", "too_large");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (total < 4) throw new GitHubSourceArchiveError("GitHub returned an empty source archive.", "invalid_archive");
  const archive = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { archive.set(chunk, offset); offset += chunk.byteLength; }
  if (archive[0] !== 0x50 || archive[1] !== 0x4b) throw new GitHubSourceArchiveError("GitHub returned an invalid ZIP archive.", "invalid_archive");
  return archive;
}
