import type { CloudflarePagesConfig } from "./cloudflare-pages";

export type PagesDomainStatus = "initializing" | "pending" | "active" | "deactivated" | "blocked" | "error" | "unknown";
export type PagesDomain = {
  id: string;
  name: string;
  status: PagesDomainStatus;
  validation: { method: "http" | "txt" | null; status: PagesDomainStatus; error: string | null; txtName: string | null; txtValue: string | null };
  verification: { status: PagesDomainStatus; error: string | null };
  createdAt: string | null;
};

type CloudflareEnvelope<T> = { success?: boolean; result?: T; errors?: { message?: string }[] };
type RawDomain = {
  id?: unknown; name?: unknown; status?: unknown; created_on?: unknown;
  validation_data?: { method?: unknown; status?: unknown; error_message?: unknown; txt_name?: unknown; txt_value?: unknown };
  verification_data?: { status?: unknown; error_message?: unknown };
};

const MAX_DOMAINS_PER_PROJECT = 500;

const DOMAIN_STATUSES = new Set<PagesDomainStatus>(["initializing", "pending", "active", "deactivated", "blocked", "error"]);
function status(value: unknown): PagesDomainStatus {
  return typeof value === "string" && DOMAIN_STATUSES.has(value as PagesDomainStatus) ? value as PagesDomainStatus : "unknown";
}
function cleanText(value: unknown, max = 500): string | null {
  return typeof value === "string" && value.length > 0 ? value.slice(0, max) : null;
}
function domainEndpoint(config: CloudflarePagesConfig, domain?: string): URL {
  const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/pages/projects/${encodeURIComponent(config.projectName)}/domains`);
  if (domain) url.pathname += "/" + encodeURIComponent(domain);
  return url;
}
function mapDomain(raw: RawDomain): PagesDomain {
  return {
    id: cleanText(raw.id, 128) ?? "",
    name: cleanText(raw.name, 253) ?? "",
    status: status(raw.status),
    validation: {
      method: raw.validation_data?.method === "http" || raw.validation_data?.method === "txt" ? raw.validation_data.method : null,
      status: status(raw.validation_data?.status),
      error: cleanText(raw.validation_data?.error_message),
      txtName: cleanText(raw.validation_data?.txt_name, 253),
      txtValue: cleanText(raw.validation_data?.txt_value, 1000),
    },
    verification: {
      status: status(raw.verification_data?.status),
      error: cleanText(raw.verification_data?.error_message),
    },
    createdAt: cleanText(raw.created_on, 64),
  };
}

async function cloudflareRequest<T>(
  config: CloudflarePagesConfig,
  url: URL,
  init: RequestInit,
  fetcher: typeof fetch,
): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      headers: {
        Authorization: "Bearer " + config.apiToken,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("Cloudflare custom-domain service is temporarily unavailable.");
  }
  if (response.status === 404 && init.method === "DELETE") return undefined as T;
  if (response.status === 204 && init.method === "DELETE") return undefined as T;
  let payload: CloudflareEnvelope<T>;
  try { payload = await response.json() as CloudflareEnvelope<T>; }
  catch { throw new Error("Cloudflare returned an invalid custom-domain response."); }
  if (!response.ok || payload.success !== true) {
    const providerMessage = payload.errors?.[0]?.message;
    if (response.status === 409) throw new Error("This domain is already attached to a Pages project.");
    if (response.status === 400 && providerMessage) throw new Error("Cloudflare rejected this domain. Check that it is valid and available.");
    throw new Error("Cloudflare could not complete the custom-domain request.");
  }
  return payload.result as T;
}

export function normalizeCustomDomain(input: string): string {
  const value = input.trim().toLowerCase().replace(/\.$/, "");
  if (!value || value.length > 253 || value.includes("*") || value.includes("/") || value.includes("@")) {
    throw new Error("Enter a valid domain name, such as www.example.com.");
  }
  let parsed: URL;
  try { parsed = new URL("https://" + value); }
  catch { throw new Error("Enter a valid domain name, such as www.example.com."); }
  const hostname = parsed.hostname;
  if (parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password ||
      hostname !== value || !hostname.includes(".") || hostname === "localhost" ||
      /^\d+(\.\d+){3}$/.test(hostname) || hostname.endsWith(".pages.dev") ||
      hostname.split(".").some((part) => !part || part.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(part))) {
    throw new Error("Enter a valid public domain name, not a URL, IP address, or pages.dev hostname.");
  }
  return hostname;
}

export async function listPagesDomains(config: CloudflarePagesConfig, fetcher: typeof fetch = fetch): Promise<PagesDomain[]> {
  const result = await cloudflareRequest<RawDomain[]>(config, domainEndpoint(config), { method: "GET" }, fetcher);
  if (!Array.isArray(result) || result.length > MAX_DOMAINS_PER_PROJECT) {
    throw new Error("Cloudflare returned an invalid custom-domain list.");
  }
  return result.map(mapDomain).filter((domain) => domain.name);
}

export async function addPagesDomain(config: CloudflarePagesConfig, domain: string, fetcher: typeof fetch = fetch): Promise<PagesDomain> {
  const normalized = normalizeCustomDomain(domain);
  const result = await cloudflareRequest<RawDomain>(config, domainEndpoint(config), {
    method: "POST",
    body: JSON.stringify({ name: normalized }),
  }, fetcher);
  const mapped = mapDomain(result);
  if (!mapped.name) throw new Error("Cloudflare did not return the attached domain.");
  return mapped;
}

export async function removePagesDomain(config: CloudflarePagesConfig, domain: string, fetcher: typeof fetch = fetch): Promise<void> {
  const normalized = normalizeCustomDomain(domain);
  await cloudflareRequest<unknown>(config, domainEndpoint(config, normalized), { method: "DELETE" }, fetcher);
}
