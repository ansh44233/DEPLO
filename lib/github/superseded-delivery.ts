/**
 * Whether a newer push (or a newer commit on the same pull request) is already
 * queued, running or deployed for this repository and branch. A worker checks
 * this right before publishing, so when two pushes build at the same time the
 * older one never overwrites the newer one on Cloudflare.
 */
export type DeliveryForOrdering = {
  delivery_id: string;
  repository_full_name: string;
  branch: string;
  received_at?: string | null;
  pull_request_number?: number | null;
};

export function newerDeliveryQuery(baseUrl: string, delivery: DeliveryForOrdering): URL | null {
  if (!delivery.received_at || Number.isNaN(Date.parse(delivery.received_at))) return null;
  const url = new URL("/rest/v1/github_webhook_deliveries", baseUrl);
  url.searchParams.set("select", "delivery_id");
  url.searchParams.set("repository_full_name", "eq." + delivery.repository_full_name);
  url.searchParams.set("branch", "eq." + delivery.branch);
  url.searchParams.set("pull_request_number", typeof delivery.pull_request_number === "number" ? "eq." + delivery.pull_request_number : "is.null");
  url.searchParams.set("received_at", "gt." + new Date(delivery.received_at).toISOString());
  url.searchParams.set("status", "in.(received,processing,deployed)");
  url.searchParams.set("delivery_id", "neq." + delivery.delivery_id);
  url.searchParams.set("limit", "1");
  return url;
}

/** True when a newer delivery exists. Errors count as "no": publishing late beats not publishing. */
export async function hasNewerDelivery(
  baseUrl: string,
  serviceKey: string,
  delivery: DeliveryForOrdering,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const url = newerDeliveryQuery(baseUrl, delivery);
  if (!url) return false;
  try {
    const response = await fetcher(url, {
      headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return false;
    const rows = await response.json() as unknown;
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}
