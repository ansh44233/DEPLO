import { readBuildRunnerConfiguration } from "./build-runner-contract";

export type DeploymentReadiness = {
  provider: "cloudflare-pages";
  configured: boolean;
  uploadAuthenticationConfigured: boolean;
  legacySharedProjectConfigured: boolean;
  ready: boolean;
  missing: string[];
  /** A self-hosted build runner is configured, so the Builds tab can queue jobs. */
  buildRunnerConfigured: boolean;
};

export function getDeploymentReadiness(
  env: Record<string, string | undefined>,
): DeploymentReadiness {
  const missing: string[] = [];
  if (!env.CLOUDFLARE_ACCOUNT_ID?.trim()) missing.push("CLOUDFLARE_ACCOUNT_ID");
  if (!env.CLOUDFLARE_API_TOKEN?.trim()) missing.push("CLOUDFLARE_API_TOKEN");

  const legacyProjectName = env.CLOUDFLARE_PAGES_PROJECT_NAME?.trim() ?? "";
  const legacySharedProjectConfigured = /^[a-z0-9][a-z0-9-]{0,62}$/.test(legacyProjectName);
  const uploadAuthenticationConfigured = (env.DEPLO_UPLOAD_TOKEN?.length ?? 0) >= 32;
  const configured = missing.length === 0;

  return {
    provider: "cloudflare-pages",
    configured,
    uploadAuthenticationConfigured,
    legacySharedProjectConfigured,
    ready: configured,
    missing,
    buildRunnerConfigured: readBuildRunnerConfiguration(env) !== null,
  };
}
