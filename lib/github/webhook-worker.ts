import { parsePublicGitHubUrl } from "./parse-repository-url";

export type WebhookProjectCandidate = {
  id: string;
  owner_github_id: number;
  slug: string;
  repository_url: string | null;
  branch: string | null;
  source_type: string;
};

export function matchesWebhookProject(
  project: WebhookProjectCandidate,
  repositoryFullName: string,
  branch: string,
): boolean {
  if (project.source_type !== "github" || project.branch !== branch || !project.repository_url) return false;
  const parsed = parsePublicGitHubUrl(project.repository_url);
  if (!parsed) return false;
  return (parsed.owner + "/" + parsed.repository).toLowerCase() === repositoryFullName.toLowerCase();
}

export function getWebhookRetryDelaySeconds(attemptCount: number): number {
  if (!Number.isInteger(attemptCount) || attemptCount < 1) return 30;
  return Math.min(3600, 30 * 2 ** Math.min(attemptCount - 1, 7));
}
