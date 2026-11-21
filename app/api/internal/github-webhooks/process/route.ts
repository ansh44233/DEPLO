import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { extractZipSafely } from "@/lib/uploads/extract-zip";
import { inspectStaticDirectory } from "@/lib/deploy/static-assets";
import { deployStaticDirectory, readCloudflarePagesCredentials } from "@/lib/deploy/cloudflare-pages";
import { ensureCloudflarePagesProject, getAccountPagesTarget } from "@/lib/deploy/cloudflare-projects";
import { matchesWebhookProject, type WebhookProjectCandidate } from "@/lib/github/webhook-worker";
import { createInstallationAccessToken } from "@/lib/github/app-auth";
import { getGitHubArchiveHeaders } from "@/lib/github/webhook-archive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
type Delivery = { delivery_id: string; repository_full_name: string; branch: string; commit_sha: string; attempt_count: number };
type Project = WebhookProjectCandidate;

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

function authorized(header: string | null, secret: string): boolean {
  if (secret.length < 32 || !header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function databaseConfig() {
  const baseUrl = process.env.SUPABASE_URL?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!baseUrl || !serviceKey) return null;
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") return null;
    return { baseUrl: parsed.toString().replace(/\/$/, ""), serviceKey };
  } catch {
    return null;
  }
}

async function db<T>(url: URL, key: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Webhook database operation failed.");
  if (response.status === 204) return [] as T;
  return await response.json() as T;
}

function endpoint(baseUrl: string, table: string, query: Record<string, string> = {}) {
  const url = new URL("/rest/v1/" + table, baseUrl);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url;
}

async function getInstallationId(baseUrl: string, key: string, ownerGithubId: number): Promise<number | null> {
  const rows = await db<{ installation_id: number }[]>(
    endpoint(baseUrl, "github_app_installations", {
      select: "installation_id",
      owner_github_id: "eq." + ownerGithubId,
      suspended_at: "is.null",
      limit: "1",
    }),
    key,
    { method: "GET" },
  );
  const id = rows[0]?.installation_id;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function claimDelivery(baseUrl: string, key: string): Promise<Delivery | null> {
  const rows = await db<Delivery[]>(
    endpoint(baseUrl, "rpc/claim_next_github_webhook_delivery"),
    key,
    { method: "POST", body: "{}" },
  );
  return rows[0] ?? null;
}

async function setDeliveryStatus(
  baseUrl: string,
  key: string,
  deliveryId: string,
  status: "deployed" | "ignored" | "failed",
  errorCode?: string,
) {
  await db<unknown[]>(
    endpoint(baseUrl, "rpc/finish_github_webhook_delivery"),
    key,
    {
      method: "POST",
      body: JSON.stringify({
        p_delivery_id: deliveryId,
        p_status: status,
        p_error_code: errorCode ?? null,
      }),
    },
  );
}

async function downloadArchive(url: string, destination: string, installationToken?: string): Promise<void> {
  const response = await fetch(url, {
    headers: getGitHubArchiveHeaders(installationToken),
    signal: AbortSignal.timeout(30_000),
    redirect: "follow",
    cache: "no-store",
  });
  if (response.status === 404) throw new Error("repository_unavailable");
  if (!response.ok || !response.body) throw new Error("github_archive_unavailable");
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_ARCHIVE_BYTES) throw new Error("archive_too_large");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_ARCHIVE_BYTES) {
        await reader.cancel();
        throw new Error("archive_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const archive = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  if (archive.length < 4 || archive[0] !== 0x50 || archive[1] !== 0x4b) throw new Error("invalid_archive");
  await writeFile(destination, archive, { flag: "wx", mode: 0o600 });
}

export async function POST(request: NextRequest) {
  const workerSecret = process.env.DEPLO_WEBHOOK_WORKER_SECRET ?? "";
  if (!authorized(request.headers.get("authorization"), workerSecret)) return error("Authentication required.", 401);
  const config = databaseConfig();
  if (!config) return error("Webhook worker storage is not configured.", 503);
  const cloudflare = readCloudflarePagesCredentials();
  if (!cloudflare) return error("Cloudflare Pages is not configured.", 503);

  let delivery: Delivery | null;
  try {
    delivery = await claimDelivery(config.baseUrl, config.serviceKey);
  } catch {
    return error("A queued GitHub delivery could not be claimed.", 502);
  }
  if (!delivery) return NextResponse.json({ processed: false, reason: "queue-empty" }, { headers: { "Cache-Control": "no-store" } });

  try {
    const projects = await db<Project[]>(
      endpoint(config.baseUrl, "projects", {
        select: "id,owner_github_id,slug,repository_url,branch,source_type",
        source_type: "eq.github",
        branch: "eq." + delivery.branch,
        limit: "500",
      }),
      config.serviceKey,
      { method: "GET" },
    );
    const matches = projects.filter((project) => matchesWebhookProject(project, delivery!.repository_full_name, delivery!.branch));
    if (matches.length === 0) {
      await setDeliveryStatus(config.baseUrl, config.serviceKey, delivery.delivery_id, "ignored");
      return NextResponse.json({ processed: true, deployed: 0, ignored: true }, { headers: { "Cache-Control": "no-store" } });
    }

    let deployed = 0;
    for (const project of matches) {
      const installationId = await getInstallationId(config.baseUrl, config.serviceKey, project.owner_github_id);
      let installationToken: string | undefined;
      if (installationId !== null) {
        const appId = process.env.GITHUB_APP_ID?.trim() ?? "";
        const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.trim() ?? "";
        if (!appId || !privateKey) throw new Error("github_app_not_configured");
        installationToken = await createInstallationAccessToken(installationId, appId, privateKey);
      }

      const workRoot = await mkdtemp(join(tmpdir(), "deplo-webhook-"));
      try {
        const archivePath = join(workRoot, "repository.zip");
        const extractedRoot = join(workRoot, "extracted");
        const archiveUrl = "https://api.github.com/repos/" +
          delivery.repository_full_name.split("/").map(encodeURIComponent).join("/") +
          "/zipball/" + encodeURIComponent(delivery.commit_sha);
        await downloadArchive(archiveUrl, archivePath, installationToken);
        await extractZipSafely(archivePath, extractedRoot);
        const roots = await readdir(extractedRoot, { withFileTypes: true });
        const siteRoot = roots.length === 1 && roots[0].isDirectory() ? join(extractedRoot, roots[0].name) : extractedRoot;
        const index = await stat(join(siteRoot, "index.html")).catch(() => null);
        if (!index?.isFile()) throw new Error("root_index_missing");
        await inspectStaticDirectory(siteRoot);

        const target = getAccountPagesTarget(cloudflare, project.owner_github_id, project.slug);
        await ensureCloudflarePagesProject(target.config, target.productionBranch);
        const deployment = await deployStaticDirectory(siteRoot, target.productionBranch, target.config);
        const saved = await db<Project[]>(
          endpoint(config.baseUrl, "projects", {
            select: "id",
            id: "eq." + project.id,
            owner_github_id: "eq." + project.owner_github_id,
          }),
          config.serviceKey,
          {
            method: "PATCH",
            headers: { Prefer: "return=representation" },
            body: JSON.stringify({ deployment_url: deployment.url, updated_at: new Date().toISOString() }),
          },
        );
        if (!saved.length) throw new Error("project_update_failed");
        deployed += 1;
      } finally {
        await rm(workRoot, { recursive: true, force: true }).catch(() => undefined);
      }
    }
    await setDeliveryStatus(config.baseUrl, config.serviceKey, delivery.delivery_id, "deployed");
    return NextResponse.json({ processed: true, deployed }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const code = cause instanceof Error && /^[a-z_]{3,64}$/.test(cause.message) ? cause.message : "deployment_failed";
    await setDeliveryStatus(config.baseUrl, config.serviceKey, delivery.delivery_id, "failed", code).catch(() => undefined);
    return NextResponse.json({ processed: true, deployed: 0, error: code }, {
      status: 502,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
