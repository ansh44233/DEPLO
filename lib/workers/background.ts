import { timingSafeEqual } from "node:crypto";

export type WorkerPath = "/api/internal/github-webhooks/process" | "/api/internal/build-jobs/process";

/**
 * Constant-time bearer check that accepts any of the configured secrets.
 * Secrets shorter than 32 characters are ignored so an unset value never matches.
 */
export function isAuthorizedWorkerRequest(header: string | null, secrets: (string | undefined)[]): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  let matched = false;
  for (const secret of secrets) {
    if (!secret || secret.length < 32) continue;
    const expected = Buffer.from(secret);
    if (supplied.length === expected.length && timingSafeEqual(supplied, expected)) matched = true;
  }
  return matched;
}

/** Public base URL this deployment can call itself on. */
export function resolveSelfBaseUrl(env: Record<string, string | undefined> = process.env): string | null {
  const candidates = [
    env.DEPLO_BASE_URL?.trim(),
    env.VERCEL_PROJECT_PRODUCTION_URL?.trim() ? "https://" + env.VERCEL_PROJECT_PRODUCTION_URL.trim() : undefined,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1") return url.origin;
    } catch { /* try the next candidate */ }
  }
  return null;
}

/**
 * Builds the request that asks a protected worker endpoint to process one queue item.
 * Returns null when the base URL or worker secret is not configured.
 */
export function buildWorkerKick(
  path: WorkerPath,
  secret: string | undefined,
  env: Record<string, string | undefined> = process.env,
): { url: string; init: RequestInit } | null {
  const base = resolveSelfBaseUrl(env);
  if (!base || !secret || secret.length < 32) return null;
  return {
    url: base + path,
    init: {
      method: "POST",
      headers: { Authorization: "Bearer " + secret },
      cache: "no-store",
      signal: AbortSignal.timeout(295_000),
    },
  };
}

/**
 * Fire a worker step. Intended to run inside Next.js `after()` so the user's
 * request returns first. Failures are swallowed: cron and retries are the backstop.
 */
export async function kickWorker(
  path: WorkerPath,
  secret: string | undefined,
  env: Record<string, string | undefined> = process.env,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const request = buildWorkerKick(path, secret, env);
  if (!request) return false;
  try {
    const response = await fetcher(request.url, request.init);
    await response.body?.cancel().catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

/**
 * Drains a worker by repeatedly invoking its single-step handler until the queue
 * is empty, a step fails, or the time budget is spent. Used by scheduled (cron) runs.
 */
export async function drainWorker(
  step: () => Promise<Response>,
  options: { maxSteps?: number; budgetMs?: number; now?: () => number } = {},
): Promise<{ steps: number; lastStatus: number; drained: boolean }> {
  const maxSteps = options.maxSteps ?? 20;
  const budgetMs = options.budgetMs ?? 240_000;
  const now = options.now ?? Date.now;
  const started = now();
  let steps = 0;
  let lastStatus = 200;
  while (steps < maxSteps && now() - started < budgetMs) {
    const response = await step();
    steps += 1;
    lastStatus = response.status;
    let body: { processed?: unknown } | null = null;
    try { body = await response.json() as { processed?: unknown }; } catch { body = null; }
    if (!response.ok || body?.processed !== true) return { steps, lastStatus, drained: response.ok && body?.processed === false };
  }
  return { steps, lastStatus, drained: false };
}
