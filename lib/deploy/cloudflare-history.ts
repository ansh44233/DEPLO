import type { CloudflarePagesConfig } from "./cloudflare-pages";

export type CloudflareDeployment = {
  id: string;
  url: string;
  environment: string;
  createdAt: string | null;
  branch: string | null;
  commitMessage: string | null;
  status: "success" | "failure" | "building" | "unknown";
};

type CloudflareApiResponse = {
  success?: boolean;
  result?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeStatus(value: unknown): CloudflareDeployment["status"] {
  if (typeof value !== "string") return "unknown";
  const status = value.toLowerCase();
  if (["success", "failure", "building"].includes(status)) {
    return status as CloudflareDeployment["status"];
  }
  if (status === "active" || status === "completed") return "success";
  if (status === "error" || status === "failed") return "failure";
  if (status === "in_progress" || status === "running") return "building";
  return "unknown";
}

export function normalizeCloudflareDeployments(value: unknown): CloudflareDeployment[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = textOrNull(item.id);
    const url = textOrNull(item.url);
    if (!id || !url || !/^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.pages\.dev(?:\/.*)?$/i.test(url)) return [];

    const trigger = isRecord(item.deployment_trigger) ? item.deployment_trigger : {};
    const metadata = isRecord(trigger.metadata) ? trigger.metadata : {};
    const stage = isRecord(item.latest_stage) ? item.latest_stage : {};
    const branch = textOrNull(metadata.branch);
    const commitMessage = textOrNull(metadata.commit_message);

    return [{
      id,
      url,
      environment: textOrNull(item.environment) ?? "unknown",
      createdAt: textOrNull(item.created_on),
      branch,
      commitMessage,
      status: normalizeStatus(stage.status),
    }];
  });
}

export async function listCloudflarePagesDeployments(
  config: CloudflarePagesConfig,
  fetcher: typeof fetch = fetch,
): Promise<CloudflareDeployment[]> {
  const endpoint = new URL(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/pages/projects/${encodeURIComponent(config.projectName)}/deployments`,
  );
  endpoint.searchParams.set("per_page", "20");

  const response = await fetcher(endpoint, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Cloudflare Pages deployment history could not be loaded.");

  const payload = await response.json() as CloudflareApiResponse;
  if (payload.success !== true || !Array.isArray(payload.result)) {
    throw new Error("Cloudflare Pages returned an invalid deployment history response.");
  }
  return normalizeCloudflareDeployments(payload.result);
}
