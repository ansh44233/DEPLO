export function getGitHubArchiveHeaders(installationToken?: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "DEPLO",
    ...(installationToken
      ? {
          Authorization: "Bearer " + installationToken,
          "X-GitHub-Api-Version": "2022-11-28",
        }
      : {}),
  };
}
