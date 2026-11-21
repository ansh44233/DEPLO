export type DeploymentReadiness = {
  provider: "cloudflare-pages";
  configured: boolean;
  uploadAuthenticationConfigured: boolean;
  ready: boolean;
  missing: string[];
};

export function getDeploymentReadiness(
  env: Record<string, string | undefined>,
): DeploymentReadiness {
  const missing: string[] = [];
  if (!env.CLOUDFLARE_ACCOUNT_ID?.trim()) missing.push("CLOUDFLARE_ACCOUNT_ID");
  if (!env.CLOUDFLARE_API_TOKEN?.trim()) missing.push("CLOUDFLARE_API_TOKEN");
  const projectName = env.CLOUDFLARE_PAGES_PROJECT_NAME?.trim() ?? "";
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(projectName)) {
    missing.push("CLOUDFLARE_PAGES_PROJECT_NAME");
  }
  const uploadAuthenticationConfigured = (env.DEPLO_UPLOAD_TOKEN?.length ?? 0) >= 32;
  const configured = missing.length === 0;
  return {
    provider: "cloudflare-pages",
    configured,
    uploadAuthenticationConfigured,
    ready: configured && uploadAuthenticationConfigured,
    missing,
  };
}
