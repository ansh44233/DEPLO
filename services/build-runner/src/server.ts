import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { extractZipSafely } from "../../../lib/uploads/extract-zip";
import { cleanupStaleWorkspaces } from "./workspace-janitor";
import { join, isAbsolute, resolve } from "node:path";
import { isIP } from "node:net";

const MAX_ARCHIVE = 25 * 1024 * 1024;
const MAX_BODY = MAX_ARCHIVE + 64 * 1024;
type RunnerConfig = { token: string; dataDir: string; workspaceDir?: string; bindHost?: string };

/** Only loopback and private/link-local IPs are valid runner bind addresses. */
export function validateRunnerBindHost(host: string): string {
  if (host === "localhost") return host;
  const version = isIP(host);
  if (version === 4) {
    const octets = host.split(".").map(Number);
    const [a, b] = octets;
    if (a === 10 || a === 127 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31 || a === 169 && b === 254) return host;
  }
  if (version === 6) {
    const normalized = host.toLowerCase();
    if (normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab][0-9a-f]:/.test(normalized)) return host;
  }
  throw new Error("runner_bind_host_must_be_loopback_or_private");
}
type Part = { name: string; filename?: string; bytes: Buffer };

function json(res: ServerResponse, status: number, body: Record<string, unknown>) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(JSON.stringify(body));
}
function authorized(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
async function readBody(req: IncomingMessage): Promise<Buffer> {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY) throw new Error("body_too_large");
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > MAX_BODY) throw new Error("body_too_large");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, total);
}
function parseMultipart(contentType: string, body: Buffer): Part[] {
  const match = /^multipart\/form-data\s*;\s*boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = (match?.[1] ?? match?.[2] ?? "").trim();
  if (!boundary || boundary.length > 70 || /[^\x21-\x7e]/.test(boundary)) throw new Error("invalid_multipart");
  const marker = Buffer.from("--" + boundary);
  const separator = Buffer.from("\r\n--" + boundary);
  if (!body.subarray(0, marker.length).equals(marker)) throw new Error("invalid_multipart");
  const parts: Part[] = [];
  let cursor = marker.length;
  while (cursor < body.length) {
    if (body.subarray(cursor, cursor + 2).toString() === "--") break;
    if (body.subarray(cursor, cursor + 2).toString() !== "\r\n") throw new Error("invalid_multipart");
    cursor += 2;
    const headerEnd = body.indexOf("\r\n\r\n", cursor);
    if (headerEnd < 0 || headerEnd - cursor > 8192) throw new Error("invalid_multipart");
    const headers = body.subarray(cursor, headerEnd).toString("latin1");
    const disposition = /^content-disposition:\s*form-data;\s*name="([a-z]+)"(?:;\s*filename="([^"]*)")?/im.exec(headers);
    if (!disposition) throw new Error("invalid_multipart");
    const dataStart = headerEnd + 4;
    const next = body.indexOf(separator, dataStart);
    if (next < 0) throw new Error("invalid_multipart");
    parts.push({ name: disposition[1], filename: disposition[2], bytes: body.subarray(dataStart, next) });
    if (parts.length > 2) throw new Error("invalid_multipart");
    cursor = next + 2 + marker.length;
  }
  return parts;
}
function parseMetadata(raw: Buffer): { repositoryFullName: string; sourceCommitSha: string } {
  let value: unknown;
  try { value = JSON.parse(raw.toString("utf8")); } catch { throw new Error("invalid_metadata"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_metadata");
  const item = value as Record<string, unknown>;
  if (typeof item.repositoryFullName !== "string" ||
      !/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/.test(item.repositoryFullName) ||
      typeof item.sourceCommitSha !== "string" || !/^[a-f0-9]{40}$/.test(item.sourceCommitSha)) {
    throw new Error("invalid_metadata");
  }
  return { repositoryFullName: item.repositoryFullName, sourceCommitSha: item.sourceCommitSha };
}
async function validateSourceArchive(config: RunnerConfig, archive: Buffer): Promise<void> {
  await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  await chmod(config.dataDir, 0o700);
  const validationRoot = await mkdtemp(join(config.dataDir, ".validate-"));
  const archivePath = join(validationRoot, "source.zip");
  try {
    await writeFile(archivePath, archive, { flag: "wx", mode: 0o600 });
    try { await extractZipSafely(archivePath, join(validationRoot, "extracted")); }
    catch { throw new Error("invalid_archive"); }
  } finally { await rm(validationRoot, { recursive: true, force: true }); }
}
async function saveSource(config: RunnerConfig, key: string, metadata: ReturnType<typeof parseMetadata>, archive: Buffer) {
  const digest = createHash("sha256").update(archive).digest("hex");
  const keyId = createHash("sha256").update(key).digest("hex");
  const sourceId = "src_" + createHash("sha256").update(key).update(digest).digest("hex").slice(0, 48);
  await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  await chmod(config.dataDir, 0o700);
  const archivePath = join(config.dataDir, sourceId + ".zip");
  const recordPath = join(config.dataDir, "idem-" + keyId + ".json");
  let createdArchive = false;
  try {
    await writeFile(archivePath, archive, { flag: "wx", mode: 0o600 });
    createdArchive = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await readFile(archivePath);
    if (createHash("sha256").update(existing).digest("hex") !== digest) throw new Error("source_conflict");
  }
  const record = { sourceId, digest, ...metadata };
  try {
    await writeFile(recordPath, JSON.stringify(record), { flag: "wx", mode: 0o600 });
    return { sourceId, duplicate: false };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      if (createdArchive) await rm(archivePath, { force: true });
      throw error;
    }
    try {
      const existing = JSON.parse(await readFile(recordPath, "utf8")) as typeof record;
      if (existing.digest !== digest || existing.repositoryFullName !== metadata.repositoryFullName ||
          existing.sourceCommitSha !== metadata.sourceCommitSha) throw new Error("source_conflict");
      return { sourceId: existing.sourceId, duplicate: true };
    } catch (recordError) {
      if (createdArchive) await rm(archivePath, { force: true });
      throw recordError;
    }
  }
}

const SOURCE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const CLEANUP_BATCH_LIMIT = 100;
async function cleanupExpiredSources(dataDir: string, now = Date.now()) {
  const entries = await readdir(dataDir, { withFileTypes: true });
  const expired = new Set<string>();
  let bytesFreed = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !/^src_[a-f0-9]{48}\.zip$/.test(entry.name)) continue;
    if (expired.size >= CLEANUP_BATCH_LIMIT) break;
    const path = join(dataDir, entry.name);
    let info;
    try { info = await stat(path); } catch { continue; }
    if (now - info.mtimeMs < SOURCE_RETENTION_MS) continue;
    await rm(path, { force: true });
    expired.add(entry.name.slice(0, -4));
    bytesFreed += info.size;
  }
  let recordsRemoved = 0;
  if (expired.size) {
    for (const entry of entries) {
      if (!entry.isFile() || !/^idem-[a-f0-9]{64}\.json$/.test(entry.name)) continue;
      const path = join(dataDir, entry.name);
      try {
        const record = JSON.parse(await readFile(path, "utf8")) as { sourceId?: unknown };
        if (typeof record.sourceId === "string" && expired.has(record.sourceId)) {
          await rm(path, { force: true });
          recordsRemoved++;
        }
      } catch { /* Preserve malformed records for operator inspection. */ }
    }
  }
  return { sourcesRemoved: expired.size, recordsRemoved, bytesFreed };
}
export function createRunnerServer(config: RunnerConfig) {
  if (config.token.length < 32) throw new Error("Runner token must contain at least 32 characters.");
  if (!isAbsolute(config.dataDir)) throw new Error("Runner data directory must be absolute.");
  if (config.workspaceDir && !isAbsolute(config.workspaceDir)) throw new Error("Runner workspace directory must be absolute.");
  const bindHost = validateRunnerBindHost(config.bindHost ?? "127.0.0.1");
  config = { ...config, dataDir: resolve(config.dataDir), workspaceDir: config.workspaceDir ? resolve(config.workspaceDir) : undefined, bindHost };
  const server = createServer({
    headersTimeout: 15_000, requestTimeout: 120_000, keepAliveTimeout: 5_000, maxHeaderSize: 16 * 1024,
  }, async (req, res) => {
    try {
      const path = new URL(req.url ?? "/", "http://runner.local").pathname;
      if (req.method === "GET" && path === "/healthz") {
        return json(res, 200, { ok: true, service: "deplo-build-runner", buildsEnabled: false });
      }
      if (req.method === "POST" && path === "/v1/sources") {
        if (!authorized(req, config.token)) return json(res, 401, { error: "unauthorized" });
        const key = req.headers["idempotency-key"];
        if (typeof key !== "string" || !/^[a-f0-9-]{36}$/i.test(key)) return json(res, 400, { error: "invalid_idempotency_key" });
        const body = await readBody(req);
        const parts = parseMultipart(req.headers["content-type"] ?? "", body);
        const metadataParts = parts.filter(part => part.name === "metadata");
        const archiveParts = parts.filter(part => part.name === "archive");
        if (parts.length !== 2 || metadataParts.length !== 1 || archiveParts.length !== 1 ||
            archiveParts[0].filename !== "source.zip") return json(res, 400, { error: "invalid_source_form" });
        const archive = archiveParts[0].bytes;
        if (archive.length < 4 || archive.length > MAX_ARCHIVE || archive[0] !== 0x50 || archive[1] !== 0x4b) {
          return json(res, 413, { error: "invalid_or_oversized_archive" });
        }
        const metadata = parseMetadata(metadataParts[0].bytes);
        await validateSourceArchive(config, archive);
        const saved = await saveSource(config, key, metadata, archive);
        return json(res, saved.duplicate ? 200 : 201, { sourceId: saved.sourceId });
      }
      if (req.method === "POST" && path === "/v1/maintenance/cleanup") {
        if (!authorized(req, config.token)) return json(res, 401, { error: "unauthorized" });
        const result = await cleanupExpiredSources(config.dataDir);
        const workspaces = config.workspaceDir
          ? await cleanupStaleWorkspaces(config.workspaceDir)
          : undefined;
        return json(res, 200, { ...result, ...(workspaces ?? {}) });
      }
      if (req.method === "POST" && path === "/v1/builds") {
        if (!authorized(req, config.token)) return json(res, 401, { error: "unauthorized" });
        return json(res, 503, { error: "sandbox_not_configured" });
      }
      if (path.startsWith("/v1/") && !authorized(req, config.token)) return json(res, 401, { error: "unauthorized" });
      return json(res, 404, { error: "not_found" });
    } catch (error) {
      if (res.headersSent) return res.destroy();
      const code = error instanceof Error ? error.message : "internal_error";
      if (code === "body_too_large") return json(res, 413, { error: code });
      if (code === "source_conflict") return json(res, 409, { error: code });
      if (["invalid_multipart", "invalid_metadata", "invalid_archive"].includes(code)) return json(res, 400, { error: code });
      return json(res, 500, { error: "internal_error" });
    }
  });
  server.maxHeadersCount = 50;
  server.maxRequestsPerSocket = 100;
  return server;
}

if (process.env.DEPLO_RUNNER_TOKEN && process.env.DEPLO_RUNNER_DATA_DIR) {
  const port = Number(process.env.PORT ?? 8788);
  const server = createRunnerServer({
    token: process.env.DEPLO_RUNNER_TOKEN,
    dataDir: process.env.DEPLO_RUNNER_DATA_DIR,
    workspaceDir: process.env.DEPLO_RUNNER_WORKSPACE_DIR,
    bindHost: process.env.DEPLO_RUNNER_HOST ?? "127.0.0.1",
  });
  server.listen(port, process.env.DEPLO_RUNNER_HOST ?? "127.0.0.1");
}
