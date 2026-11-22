import { createHash } from "node:crypto";
import type { CloudflarePagesConfig, CloudflarePagesCredentials } from "./cloudflare-pages";

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

function projectsCollectionEndpoint(config: CloudflarePagesConfig): URL {
  return new URL(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/pages/projects`);
}

/** Cloudflare's own error code and message, safe to show: it never echoes the token. */
async function describeCloudflareError(response: Response): Promise<string> {
  let detail = "HTTP " + response.status;
  try {
    const payload = await response.json() as { errors?: { code?: unknown; message?: unknown }[] };
    const first = payload.errors?.[0];
    if (first && typeof first.message === "string") {
      detail += ", " + (typeof first.code === "number" ? first.code + " " : "") + first.message.slice(0, 160);
    }
  } catch { /* non-JSON body */ }
  if (response.status === 401 || response.status === 403) {
    detail += ". Check that CLOUDFLARE_API_TOKEN has the Cloudflare Pages: Edit permission and CLOUDFLARE_ACCOUNT_ID is the right account.";
  }
  return detail;
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
  baseConfig: CloudflarePagesCredentials,
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
    .slice(0, 16);
  // Cloudflare Pages project names are limited to 58 characters.
  const projectName = ("deplo-" + suffix + "-" + projectSlug.slice(0, 35)).replace(/-+$/, "");
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
    const detail = await describeCloudflareError(existing);
    console.error("[deplo] Cloudflare Pages project lookup failed:", detail);
    throw new Error("Cloudflare Pages project status could not be checked (" + detail + ")");
  }

  // Projects are created on the collection endpoint, not on /projects/{name}.
  const created = await fetcher(projectsCollectionEndpoint(config), {
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
  if (!created.ok) {
    const detail = await describeCloudflareError(created);
    console.error("[deplo] Cloudflare Pages project creation failed:", detail);
    throw new Error("Cloudflare Pages project could not be created (" + detail + ")");
  }

  verifyProjectPayload(await created.json() as CloudflareProjectPayload, config, productionBranch);
}


export async function deleteCloudflarePagesProject(
  config: CloudflarePagesConfig,
  fetcher: typeof fetch = fetch,
): Promise<"deleted" | "already-absent"> {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(config.projectName)) {
    throw new Error("Invalid Cloudflare Pages project name.");
  }
  const response = await fetcher(projectEndpoint(config), {
    method: "DELETE",
    headers: {
      Authorization: "Bearer " + config.apiToken,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (response.status === 404) return "already-absent";
  if (!response.ok) {
    throw new Error("Cloudflare Pages project could not be deleted.");
  }
  if (response.status === 204) return "deleted";
  const payload = await response.json() as CloudflareProjectPayload;
  if (payload.success !== true) {
    throw new Error("Cloudflare Pages did not confirm project deletion.");
  }
  return "deleted";
}
