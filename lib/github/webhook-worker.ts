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
