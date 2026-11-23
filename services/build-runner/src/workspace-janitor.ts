import { lstat, readdir, realpath, rm } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";
import { inspectWorkspaceLease } from "./workspace-lease";
import { acquireWorkspaceOperationLock, isWorkspaceOperationLockBusy } from "./workspace-operation-lock";

export const DEFAULT_WORKSPACE_RETENTION_MS = 24 * 60 * 60 * 1000;
export const MAX_WORKSPACE_CLEANUP_BATCH = 100;

export type WorkspaceCleanupResult = Readonly<{
  workspacesRemoved: number;
  bytesFreed: number;
  skipped: number;
}>;

/** Removes old job-* directories, honoring live leases and failing closed on invalid leases. */
export async function cleanupStaleWorkspaces(
  rootPath: string,
  options: { now?: number; retentionMs?: number; batchLimit?: number } = {},
): Promise<WorkspaceCleanupResult> {
  if (!isAbsolute(rootPath) || resolve(rootPath) !== rootPath || rootPath === "/") {
    throw new Error("workspace_root_must_be_absolute_canonical_and_non_root");
  }
  const now = options.now ?? Date.now();
  const retentionMs = options.retentionMs ?? DEFAULT_WORKSPACE_RETENTION_MS;
  const batchLimit = options.batchLimit ?? MAX_WORKSPACE_CLEANUP_BATCH;
  if (!Number.isFinite(now) || !Number.isSafeInteger(retentionMs) ||
      retentionMs < 60 * 60 * 1000 || retentionMs > 30 * 24 * 60 * 60 * 1000 ||
      !Number.isSafeInteger(batchLimit) || batchLimit < 1 || batchLimit > MAX_WORKSPACE_CLEANUP_BATCH) {
    throw new Error("invalid_workspace_cleanup_policy");
  }

  const rootInfo = await lstat(rootPath);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("workspace_root_must_be_a_real_directory");
  const canonicalRoot = await realpath(rootPath);
  if (canonicalRoot !== rootPath) throw new Error("workspace_root_must_not_resolve_through_symlinks");

  const entries = await readdir(canonicalRoot, { withFileTypes: true });
  let workspacesRemoved = 0;
  let bytesFreed = 0;
  let skipped = 0;
  for (const entry of entries) {
    if (!/^job-[A-Za-z0-9_-]+$/.test(entry.name)) continue;
    if (workspacesRemoved >= batchLimit) break;
    if (!entry.isDirectory() || entry.isSymbolicLink()) { skipped++; continue; }
    const path = join(canonicalRoot, entry.name);
    let info;
    try { info = await lstat(path); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (!info.isDirectory() || info.isSymbolicLink() ||
        resolve(path) !== path || !path.startsWith(canonicalRoot + sep)) {
      skipped++;
      continue;
    }
    let releaseLock: (() => Promise<void>) | undefined;
    try {
      releaseLock = await acquireWorkspaceOperationLock(path);
    } catch (error) {
      if (isWorkspaceOperationLockBusy(error)) { skipped++; continue; }
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    try {
      const lease = await inspectWorkspaceLease(path, now, retentionMs);
      if (lease.state === "active" || lease.state === "invalid") {
        skipped++;
        continue;
      }
      const staleAt = lease.state === "expired" ? lease.lease.heartbeatAt : info.mtimeMs;
      if (now - staleAt < retentionMs) continue;
      bytesFreed += await boundedDirectoryBytes(path);
      await rm(path, { recursive: true, force: true });
      workspacesRemoved++;
    } finally {
      await releaseLock().catch(error => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      });
    }
  }
  return Object.freeze({ workspacesRemoved, bytesFreed, skipped });
}

async function boundedDirectoryBytes(root: string): Promise<number> {
  const pending: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }];
  let total = 0;
  let visited = 0;
  while (pending.length && visited < 10_000) {
    const current = pending.pop()!;
    if (current.depth > 32) continue;
    let entries;
    try { entries = await readdir(current.path, { withFileTypes: true }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      if (++visited > 10_000) break;
      const child = join(current.path, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        pending.push({ path: child, depth: current.depth + 1 });
      } else if (entry.isFile() && !entry.isSymbolicLink()) {
        try {
          const info = await lstat(child);
          if (info.isFile() && !info.isSymbolicLink()) total += info.size;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
    }
  }
  return total;
}
