const OWNER_PATTERN = /^[a-zA-Z0-9-]{1,39}$/;
const REPOSITORY_PATTERN = /^[a-zA-Z0-9_.-]{1,100}$/;

export type ParsedGitHubRepository = {
  owner: string;
  repository: string;
};

/**
 * Accept only canonical HTTPS GitHub repository URLs.
 * This deliberately rejects arbitrary hosts, credentials, ports, query strings,
 * fragments, and extra path segments before any outbound request is made.
 */
export function parsePublicGitHubUrl(value: string): ParsedGitHubRepository | null {
  let parsed: URL;

  try {
    parsed = new URL(value.trim());
  } catch {
    return null;
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "github.com" ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    return null;
  }

  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length !== 2 || parts.some((part) => part.includes("%"))) return null;

  const owner = parts[0];
  const repository = parts[1].replace(/\.git$/i, "");

  if (
    !OWNER_PATTERN.test(owner) ||
    !REPOSITORY_PATTERN.test(repository) ||
    repository === "." ||
    repository === ".."
  ) {
    return null;
  }

  return { owner, repository };
}
