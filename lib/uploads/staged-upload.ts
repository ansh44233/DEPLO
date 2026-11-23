import { randomUUID } from "node:crypto";

/**
 * Large uploads go straight from the browser to a private Supabase Storage
 * bucket with a one-time signed URL, so they never pass through the host's
 * request-body limit (4.5 MB on Vercel). The server then reads and deletes them.
 */
export const UPLOAD_BUCKET = "deplo-uploads";
export const MAX_STAGED_BYTES = 25 * 1024 * 1024;

type Env = Record<string, string | undefined>;

export class StagedUploadError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "StagedUploadError"; }
}

function storage(env: Env) {
  const base = env.SUPABASE_URL?.trim().replace(/\/$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!base || !key) throw new StagedUploadError("Upload storage is not configured.", 503);
  return { base: base + "/storage/v1", key, headers: { apikey: key, Authorization: "Bearer " + key } };
}

export function stagedPathPrefix(ownerGithubId: number, projectId: string): string {
  return ownerGithubId + "/" + projectId + "/";
}

export function isOwnStagedPath(path: unknown, ownerGithubId: number, projectId: string): path is string {
  return typeof path === "string" && path.startsWith(stagedPathPrefix(ownerGithubId, projectId)) && /^[0-9]+\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(zip|html)$/.test(path);
}

async function ensureBucket(env: Env, fetcher: typeof fetch) {
  const s = storage(env);
  const response = await fetcher(s.base + "/bucket", {
    method: "POST",
    headers: { ...s.headers, "Content-Type": "application/json" },
    body: JSON.stringify({ id: UPLOAD_BUCKET, name: UPLOAD_BUCKET, public: false, file_size_limit: MAX_STAGED_BYTES }),
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!response) throw new StagedUploadError("Upload storage is unreachable.", 502);
  if (response.ok) return;
  const text = await response.text().catch(() => "");
  if (/already exists|Duplicate/i.test(text)) return;
  throw new StagedUploadError("Upload storage could not be prepared (HTTP " + response.status + ").", 502);
}

/** Returns a one-time URL the browser can PUT the file to, and the object path to pass back. */
export async function createStagedUpload(ownerGithubId: number, projectId: string, kind: "zip" | "html", env: Env = process.env, fetcher: typeof fetch = fetch) {
  await ensureBucket(env, fetcher);
  const s = storage(env);
  const path = stagedPathPrefix(ownerGithubId, projectId) + randomUUID() + "." + kind;
  const response = await fetcher(s.base + "/object/upload/sign/" + UPLOAD_BUCKET + "/" + path, {
    method: "POST",
    headers: { ...s.headers, "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!response?.ok) throw new StagedUploadError("An upload link could not be created.", 502);
  const data = await response.json() as { url?: unknown };
  if (typeof data.url !== "string" || !data.url.startsWith("/object/upload/sign/")) throw new StagedUploadError("Upload storage returned an unexpected response.", 502);
  return { path, uploadUrl: s.base + data.url };
}

/** Downloads a staged object, enforcing the size limit, then deletes it. */
export async function takeStagedUpload(path: string, env: Env = process.env, fetcher: typeof fetch = fetch): Promise<Uint8Array> {
  const s = storage(env);
  const objectUrl = s.base + "/object/" + UPLOAD_BUCKET + "/" + path;
  try {
    const response = await fetcher(objectUrl, { headers: s.headers, signal: AbortSignal.timeout(30_000), cache: "no-store" }).catch(() => null);
    if (!response) throw new StagedUploadError("Upload storage is unreachable.", 502);
    if (response.status === 404 || response.status === 400) throw new StagedUploadError("The uploaded file was not found. Upload it again.", 404);
    if (!response.ok) throw new StagedUploadError("The uploaded file could not be read.", 502);
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_STAGED_BYTES) throw new StagedUploadError("The upload is larger than 25 MB.", 413);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_STAGED_BYTES) throw new StagedUploadError("The upload is larger than 25 MB.", 413);
    return bytes;
  } finally {
    await fetcher(s.base + "/object/" + UPLOAD_BUCKET, {
      method: "DELETE",
      headers: { ...s.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: [path] }),
      signal: AbortSignal.timeout(8_000),
    }).catch(() => undefined);
  }
}
