import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { safeEqual } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 256 * 1024;
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const DELIVERY_PATTERN = /^[0-9a-f-]{36}$/i;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const REF_PATTERN = /^refs\/heads\/(.{1,200})$/;

type PushPayload = {
  ref?: unknown;
  after?: unknown;
  deleted?: unknown;
  repository?: { full_name?: unknown };
  sender?: { id?: unknown };
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

  if (request.headers.get("x-github-event") !== "push") {
    return NextResponse.json({ accepted: true, ignored: true }, { headers: { "Cache-Control": "no-store" } });
  }

  const deliveryId = request.headers.get("x-github-delivery") ?? "";
  if (!DELIVERY_PATTERN.test(deliveryId)) return error("Invalid GitHub delivery ID.", 400);

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) return error("Webhook payload is too large.", 413);

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) return error("Webhook payload is too large.", 413);
  if (!verifySignature(rawBody, request.headers.get("x-hub-signature-256") ?? "", secret)) {
    return error("Invalid GitHub webhook signature.", 401);
  }

  let payload: PushPayload;
  try {
    payload = JSON.parse(rawBody) as PushPayload;
  } catch {
    return error("Invalid JSON webhook payload.", 400);
  }

  const repository = payload.repository?.full_name;
  const ref = payload.ref;
  const after = payload.after;
  const match = typeof ref === "string" ? REF_PATTERN.exec(ref) : null;
  if (
    typeof repository !== "string" || !REPOSITORY_PATTERN.test(repository) ||
    !match || typeof after !== "string" || !SHA_PATTERN.test(after) ||
    typeof payload.deleted !== "boolean"
  ) return error("Webhook payload is missing valid repository, branch, or commit data.", 400);

  if (payload.deleted || after === "0000000000000000000000000000000000000000") {
    return NextResponse.json({ accepted: true, ignored: true, reason: "branch-deleted" }, {
      headers: { "Cache-Control": "no-store" },
    });
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
        repository_full_name: repository.toLowerCase(),
        branch: match[1],
        commit_sha: after,
        sender_github_id: Number.isSafeInteger(payload.sender?.id) ? payload.sender?.id : null,
        status: "received",
      }),
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!stored.ok) return error("Webhook event could not be recorded.", 502);
    const rows = await stored.json() as unknown[];
    return NextResponse.json({
      accepted: true,
      duplicate: !Array.isArray(rows) || rows.length === 0,
      queued: true,
    }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch {
    return error("Webhook event storage is temporarily unavailable.", 502);
  }
}
