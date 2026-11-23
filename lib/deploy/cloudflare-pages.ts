import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import { blake3Hex } from "./blake3";
import { wasmHasher, type WasmHasher } from "./blake3-wasm";

export type CloudflarePagesCredentials = {
  accountId: string;
  apiToken: string;
};

export function cloudflarePagesDeploymentFailure(): Error {
  return new Error("Cloudflare Pages deployment failed. Check the server logs for details.");
}

export type CloudflarePagesConfig = CloudflarePagesCredentials & {
  projectName: string;
};

type DeploymentDependencies = {
  fetcher?: typeof fetch;
};

export function readCloudflarePagesCredentials(
  env: Record<string, string | undefined> = process.env,
): CloudflarePagesCredentials | null {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "";
  const apiToken = env.CLOUDFLARE_API_TOKEN?.trim() ?? "";
  if (!accountId || !apiToken) return null;
  return { accountId, apiToken };
}

export function readCloudflarePagesConfig(
  env: Record<string, string | undefined> = process.env,
): CloudflarePagesConfig | null {
  const credentials = readCloudflarePagesCredentials(env);
  const projectName = env.CLOUDFLARE_PAGES_PROJECT_NAME?.trim() ?? "";
  if (!credentials || !isValidPagesProjectName(projectName)) return null;
  return { ...credentials, projectName };
}

export function isValidPagesProjectName(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(value);
}

export function isValidPagesBranch(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(value);
}

const API_BASE = "https://api.cloudflare.com/client/v4";
// Buckets stay well under the API limits (50 MiB / 5,000 files) so that a
// typical site splits into several requests that can run at the same time.
const MAX_BUCKET_BYTES = 10 * 1024 * 1024;
const MAX_BUCKET_FILES = 250;
const UPLOAD_CONCURRENCY = 4;
const REQUEST_TIMEOUT_MS = 60_000;
// Files Cloudflare Pages treats as configuration rather than assets.
const ROOT_CONFIG_FILES = new Set(["_headers", "_redirects", "_routes.json", "_worker.js"]);
const IGNORED_SEGMENTS = new Set([".DS_Store", "node_modules", ".git"]);

const CONTENT_TYPES: Record<string, string> = {
  html: "text/html", htm: "text/html", css: "text/css", js: "application/javascript", mjs: "application/javascript",
  json: "application/json", map: "application/json", webmanifest: "application/manifest+json", txt: "text/plain",
  xml: "application/xml", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", avif: "image/avif", ico: "image/x-icon", woff: "font/woff",
  woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", wasm: "application/wasm", pdf: "application/pdf",
  mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav",
};

type PagesAsset = { manifestPath: string; absolutePath: string; hash: string; contentType: string; bytes: number };

export function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extname(path).slice(1).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Asset key used by Cloudflare Pages: BLAKE3(base64(content) + extension), first 32 hex chars.
 * Uses the Rust/WebAssembly hasher when lib/deploy/blake3.wasm is present, and the
 * JavaScript implementation otherwise; both produce the same key.
 */
export function pagesAssetHash(content: Uint8Array, path: string, hasher: WasmHasher | null = wasmHasher()): string {
  const extension = extname(path).slice(1);
  if (hasher) return Buffer.from(hasher.pagesAssetHash(content, extension)).toString("hex").slice(0, 32);
  return blake3Hex(Buffer.from(content).toString("base64") + extension).slice(0, 32);
}

async function collectAssets(root: string): Promise<{ assets: PagesAsset[]; headers: Buffer | null; redirects: Buffer | null }> {
  const absoluteRoot = resolve(root);
  const assets: PagesAsset[] = [];
  let headers: Buffer | null = null;
  let redirects: Buffer | null = null;
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORED_SEGMENTS.has(entry.name)) continue;
      const absolutePath = join(directory, entry.name);
      const relativePath = relative(absoluteRoot, absolutePath).split(sep).join("/");
      if (entry.isSymbolicLink()) throw cloudflarePagesDeploymentFailure();
      if (entry.isDirectory()) { await walk(absolutePath); continue; }
      if (!entry.isFile()) continue;
      if (directory === absoluteRoot && ROOT_CONFIG_FILES.has(entry.name)) {
        if (entry.name === "_headers") headers = await readFile(absolutePath);
        if (entry.name === "_redirects") redirects = await readFile(absolutePath);
        continue;
      }
      const content = await readFile(absolutePath);
      assets.push({
        manifestPath: "/" + relativePath,
        absolutePath,
        hash: pagesAssetHash(content, entry.name),
        contentType: contentTypeFor(entry.name),
        bytes: content.length,
      });
    }
  };
  await walk(absoluteRoot);
  return { assets, headers, redirects };
}

class PagesApiError extends Error {
  constructor(readonly step: string, readonly status: number) { super("Cloudflare Pages " + step + " failed with HTTP " + status + "."); }
}

async function callApi<T>(fetcher: typeof fetch, step: string, path: string, authorization: string, init: RequestInit = {}): Promise<T> {
  const response = await fetcher(API_BASE + path, {
    ...init,
    headers: { Authorization: "Bearer " + authorization, ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...init.headers },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  let payload: { success?: unknown; result?: unknown } | null = null;
  try { payload = await response.json() as { success?: unknown; result?: unknown }; } catch { payload = null; }
  if (!response.ok || !payload || payload.success !== true) throw new PagesApiError(step, response.status);
  return payload.result as T;
}

/**
 * Runs `task` over `items` with at most `limit` in flight. Stops starting new
 * work after the first failure and rethrows it once running tasks settle.
 */
export async function forEachConcurrently<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  let failure: { error: unknown } | null = null;
  const worker = async () => {
    while (!failure && next < items.length) {
      const item = items[next++];
      try { await task(item); } catch (error) { failure ??= { error }; }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  if (failure) throw (failure as { error: unknown }).error;
}

function buckets(assets: PagesAsset[]): PagesAsset[][] {
  const result: PagesAsset[][] = [];
  let current: PagesAsset[] = [];
  let currentBytes = 0;
  for (const asset of assets) {
    const encodedBytes = Math.ceil(asset.bytes / 3) * 4;
    if (current.length && (currentBytes + encodedBytes > MAX_BUCKET_BYTES || current.length >= MAX_BUCKET_FILES)) {
      result.push(current); current = []; currentBytes = 0;
    }
    current.push(asset); currentBytes += encodedBytes;
  }
  if (current.length) result.push(current);
  return result;
}

/**
 * Publishes a static directory to Cloudflare Pages with the Direct Upload API.
 * Runs entirely over HTTPS (no CLI child process), so it works on serverless
 * hosts such as Vercel as well as long-lived Node.js servers.
 */
export async function deployStaticDirectory(
  directory: string,
  branch: string,
  config: CloudflarePagesConfig,
  dependencies: DeploymentDependencies = {},
): Promise<{ url: string; output: string }> {
  if (!isValidPagesProjectName(config.projectName)) throw new Error("Invalid Cloudflare Pages project name.");
  if (!isValidPagesBranch(branch)) throw new Error("Invalid Cloudflare Pages branch name.");
  const fetcher = dependencies.fetcher ?? fetch;
  const account = encodeURIComponent(config.accountId);
  const project = encodeURIComponent(config.projectName);
  const log: string[] = [];
  try {
    const { assets, headers, redirects } = await collectAssets(directory);
    if (!assets.length) throw cloudflarePagesDeploymentFailure();
    const uniqueHashes = [...new Set(assets.map((asset) => asset.hash))];

    const { jwt } = await callApi<{ jwt: string }>(fetcher, "upload token", `/accounts/${account}/pages/projects/${project}/upload-token`, config.apiToken);
    if (typeof jwt !== "string" || !jwt) throw new PagesApiError("upload token", 502);

    const missing = new Set(await callApi<string[]>(fetcher, "asset check", "/pages/assets/check-missing", jwt, {
      method: "POST", body: JSON.stringify({ hashes: uniqueHashes }),
    }));
    const seen = new Set<string>();
    const toUpload = assets.filter((asset) => missing.has(asset.hash) && !seen.has(asset.hash) && seen.add(asset.hash));
    await forEachConcurrently(buckets(toUpload), UPLOAD_CONCURRENCY, async (bucket) => {
      const payload = await Promise.all(bucket.map(async (asset) => ({
        key: asset.hash,
        value: (await readFile(asset.absolutePath)).toString("base64"),
        metadata: { contentType: asset.contentType },
        base64: true,
      })));
      await callApi(fetcher, "asset upload", "/pages/assets/upload", jwt, { method: "POST", body: JSON.stringify(payload) });
    });
    await callApi(fetcher, "asset registration", "/pages/assets/upsert-hashes", jwt, {
      method: "POST", body: JSON.stringify({ hashes: uniqueHashes }),
    });
    log.push(`Uploaded ${toUpload.length} new of ${assets.length} files.`);

    const manifest: Record<string, string> = {};
    for (const asset of assets) manifest[asset.manifestPath] = asset.hash;
    const form = new FormData();
    form.append("manifest", JSON.stringify(manifest));
    form.append("branch", branch);
    form.append("commit_dirty", "true");
    if (headers) form.append("_headers", new Blob([new Uint8Array(headers)]), "_headers");
    if (redirects) form.append("_redirects", new Blob([new Uint8Array(redirects)]), "_redirects");
    const deployment = await callApi<{ id?: unknown; url?: unknown }>(fetcher, "deployment", `/accounts/${account}/pages/projects/${project}/deployments`, config.apiToken, {
      method: "POST", body: form,
    });
    const url = typeof deployment?.url === "string" && /^https:\/\/[a-z0-9.-]+\.pages\.dev(?:\/.*)?$/i.test(deployment.url) ? deployment.url : null;
    if (!url) throw new Error("Cloudflare completed the deployment but did not return a Pages deployment URL.");
    log.push("Deployment " + (typeof deployment.id === "string" ? deployment.id : "created") + " on branch " + branch + ".");
    return { url, output: log.join("\n") };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Cloudflare completed")) throw error;
    // Log the failing step and status only; never tokens, paths, or response bodies.
    console.error("[deplo] Cloudflare Pages deployment failed:", error instanceof PagesApiError ? error.message : "unexpected error");
    throw cloudflarePagesDeploymentFailure();
  }
}
