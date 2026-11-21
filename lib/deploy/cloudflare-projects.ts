import { createHash } from "node:crypto";
import type { CloudflarePagesConfig } from "./cloudflare-pages";

export type AccountPagesTarget = {
  config: CloudflarePagesConfig;
  productionBranch: string;
};

type CloudflareProjectPayload = {
  success?: boolean;
  result?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function projectEndpoint(config: CloudflarePagesConfig): URL {
  return new URL(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/pages/projects/${encodeURIComponent(config.projectName)}`,
  );
}

function verifyProjectPayload(payload: CloudflareProjectPayload, config: CloudflarePagesConfig, productionBranch: string): void {
  if (
    payload.success !== true ||
    !isRecord(payload.result) ||
    payload.result.name !== config.projectName ||
    payload.result.production_branch !== productionBranch
  ) {
    throw new Error("Cloudflare Pages project configuration does not match this DEPLO project.");
  }
}

export function getAccountPagesTarget(
  baseConfig: CloudflarePagesConfig,
  ownerGithubId: number,
  projectSlug: string,
): AccountPagesTarget {
  if (!Number.isSafeInteger(ownerGithubId) || ownerGithubId <= 0) {
    throw new Error("Invalid GitHub account ID.");
  }
  if (!/^[a-z0-9][a-z0-9-]{0,57}$/.test(projectSlug)) {
    throw new Error("Invalid DEPLO project slug.");
  }

  const suffix = createHash("sha256")
    .update(String(ownerGithubId) + ":" + projectSlug)
    .digest("hex")
    .slice(0, 12);
  const projectName = "deplo-" + suffix + "-" + projectSlug.slice(0, 44);
  const productionBranch = "site-" + projectSlug;

  return {
    config: { ...baseConfig, projectName },
    productionBranch,
  };
}

export async function ensureCloudflarePagesProject(
  config: CloudflarePagesConfig,
  productionBranch: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(config.projectName)) {
    throw new Error("Invalid Cloudflare Pages project name.");
  }
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(productionBranch)) {
    throw new Error("Invalid Cloudflare Pages production branch.");
  }

  const endpoint = projectEndpoint(config);
  const headers = {
    Authorization: "Bearer " + config.apiToken,
    Accept: "application/json",
  };
  const existing = await fetcher(endpoint, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });

  if (existing.ok) {
    const payload = await existing.json() as CloudflareProjectPayload;
    verifyProjectPayload(payload, config, productionBranch);
    return;
  }
  if (existing.status !== 404) {
    throw new Error("Cloudflare Pages project status could not be checked.");
  }

  const created = await fetcher(endpoint, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name: config.projectName, production_branch: productionBranch }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });

  if (created.status === 409) {
    const raced = await fetcher(endpoint, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!raced.ok) throw new Error("Cloudflare Pages project could not be verified after a concurrent create.");
    verifyProjectPayload(await raced.json() as CloudflareProjectPayload, config, productionBranch);
    return;
  }
  if (!created.ok) throw new Error("Cloudflare Pages project could not be created.");

  verifyProjectPayload(await created.json() as CloudflareProjectPayload, config, productionBranch);
}
