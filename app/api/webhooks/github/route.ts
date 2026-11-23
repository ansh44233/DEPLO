import { createHmac } from "node:crypto";
import { after as afterResponse, NextRequest, NextResponse } from "next/server";
import { kickWorker } from "@/lib/workers/background";
import { safeEqual } from "@/lib/auth/session";
import { normalizeInstallationLifecycleEvent } from "@/lib/github/installation-lifecycle";
import { normalizePullRequestEvent } from "@/lib/github/pull-request-preview";
import { isValidRepositoryFullName } from "@/lib/github/repository-name";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 256 * 1024;
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const DELIVERY_PATTERN = /^[0-9a-f-]{36}$/i;
const REF_PATTERN = /^refs\/heads\/(.{1,200})$/;

type PushPayload = {
  ref?: unknown;
  after?: unknown;
  deleted?: unknown;
  repository?: { full_name?: unknown };
  sender?: { id?: unknown };
};
type InstallationPayload = { action?: unknown; installation?: { id?: unknown } };
type DeliveryRecord = {
  repository_full_name: string;
  branch: string;
  commit_sha: string;
  sender_github_id: number | null;
  /** Set for pull request deliveries; `branch` is then the PR's base branch. */
  pull_request_number?: number;
};

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

function verifySignature(rawBody: string, supplied: string, secret: string): boolean {
  if (!/^sha256=[a-f0-9]{64}$/i.test(supplied)) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return safeEqual(expected.toLowerCase(), supplied.toLowerCase());
}

export async function POST(request: NextRequest) {
  const secret = process.env.DEPLO_GITHUB_WEBHOOK_SECRET ?? "";
  if (secret.length < 32) return error("GitHub webhook ingestion is not configured.", 503);

  const deliveryId = request.headers.get("x-github-delivery") ?? "";
  if (!DELIVERY_PATTERN.test(deliveryId)) return error("Invalid GitHub delivery ID.", 400);

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) return error("Webhook payload is too large.", 413);

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) return error("Webhook payload is too large.", 413);
  if (!verifySignature(rawBody, request.headers.get("x-hub-signature-256") ?? "", secret)) {
    return error("Invalid GitHub webhook signature.", 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return error("Invalid JSON webhook payload.", 400);
  }

  const event = request.headers.get("x-github-event");
  if (event === "installation") {
    const installationPayload = payload as InstallationPayload;
    const update = normalizeInstallationLifecycleEvent(installationPayload.action, installationPayload.installation?.id);
    if (!update) return NextResponse.json({ accepted: true, ignored: true }, { headers: { "Cache-Control": "no-store" } });
    const baseUrl = process.env.SUPABASE_URL?.trim();
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!baseUrl || !serviceKey) return error("GitHub App installation storage is not configured.", 503);
    try {
      const parsed = new URL(baseUrl);
      if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") return error("GitHub App installation storage is not configured.", 503);
      const endpoint = new URL("/rest/v1/github_app_installations", parsed);
      endpoint.searchParams.set("installation_id", "eq." + update.installationId);
      const method = update.operation === "delete" ? "DELETE" : "PATCH";
      const body = update.operation === "delete" ? undefined : JSON.stringify({
        suspended_at: update.operation === "suspend" ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      });
      const stored = await fetch(endpoint, {
        method,
        headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey, ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body } : {}),
        signal: AbortSignal.timeout(8_000),
        cache: "no-store",
      });
      if (!stored.ok) return error("GitHub App installation status could not be updated.", 502);
      return NextResponse.json({ accepted: true, updated: true }, { headers: { "Cache-Control": "no-store" } });
    } catch {
      return error("GitHub App installation storage is temporarily unavailable.", 502);
    }
  }
  let record: DeliveryRecord;
  if (event === "pull_request") {
    const pullRequest = normalizePullRequestEvent(payload);
    if (pullRequest.kind === "invalid") return error("Webhook payload is missing valid pull request data.", 400);
    if (pullRequest.kind === "ignore") {
      return NextResponse.json({ accepted: true, ignored: true, reason: pullRequest.reason }, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    record = {
      repository_full_name: pullRequest.repositoryFullName,
      branch: pullRequest.baseBranch,
      commit_sha: pullRequest.headSha,
      sender_github_id: pullRequest.senderGithubId,
      pull_request_number: pullRequest.number,
    };
  } else if (event === "push") {
    const pushPayload = payload as PushPayload;
    const repository = pushPayload.repository?.full_name;
    const ref = pushPayload.ref;
    const after = pushPayload.after;
    const match = typeof ref === "string" ? REF_PATTERN.exec(ref) : null;
    if (
      !isValidRepositoryFullName(repository) ||
      !match || typeof after !== "string" || !SHA_PATTERN.test(after) ||
      typeof pushPayload.deleted !== "boolean"
    ) return error("Webhook payload is missing valid repository, branch, or commit data.", 400);

    if (pushPayload.deleted || after === "0000000000000000000000000000000000000000") {
      return NextResponse.json({ accepted: true, ignored: true, reason: "branch-deleted" }, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    record = {
      repository_full_name: repository.toLowerCase(),
      branch: match[1],
      commit_sha: after,
      sender_github_id: Number.isSafeInteger(pushPayload.sender?.id) ? pushPayload.sender?.id as number : null,
    };
  } else {
    return NextResponse.json({ accepted: true, ignored: true }, { headers: { "Cache-Control": "no-store" } });
  }

  const baseUrl = process.env.SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!baseUrl || !serviceKey) return error("Webhook event storage is not configured.", 503);

  let endpoint: URL;
  try {
    endpoint = new URL("/rest/v1/github_webhook_deliveries", baseUrl);
    if (endpoint.protocol !== "https:" && endpoint.hostname !== "localhost") return error("Webhook event storage is not configured.", 503);
  } catch {
    return error("Webhook event storage is not configured.", 503);
  }
  endpoint.searchParams.set("on_conflict", "delivery_id");

  try {
    const stored = await fetch(endpoint, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: "Bearer " + serviceKey,
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=representation",
      },
      body: JSON.stringify({
        delivery_id: deliveryId,
        ...record,
        status: "received",
      }),
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!stored.ok) return error("Webhook event could not be recorded.", 502);
    const rows = await stored.json() as unknown[];
    const duplicate = !Array.isArray(rows) || rows.length === 0;
    // Process the delivery right after responding to GitHub; cron and retries remain the backstop.
    if (!duplicate) afterResponse(() => kickWorker("/api/internal/github-webhooks/process", process.env.DEPLO_WEBHOOK_WORKER_SECRET));
    return NextResponse.json({
      accepted: true,
      duplicate,
      queued: true,
    }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch {
    return error("Webhook event storage is temporarily unavailable.", 502);
  }
}
