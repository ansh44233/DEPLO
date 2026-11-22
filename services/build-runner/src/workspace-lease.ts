import { randomUUID } from "node:crypto";
import { lstat, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const LEASE_FILE = ".deplo-workspace-lease.json";
const MAX_LEASE_BYTES = 2048;
const FUTURE_CLOCK_SKEW_MS = 60_000;

export type WorkspaceLease = Readonly<{
  leaseId: string;
  workspaceId: string;
  createdAt: number;
  heartbeatAt: number;
}>;

export type WorkspaceLeaseState =
  | Readonly<{ state: "active"; lease: WorkspaceLease }>
  | Readonly<{ state: "expired"; lease: WorkspaceLease }>
  | Readonly<{ state: "missing" }>
  | Readonly<{ state: "invalid" }>;

function isLease(value: unknown, workspaceId: string): value is WorkspaceLease {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return item.version === 1 &&
    item.workspaceId === workspaceId &&
    typeof item.leaseId === "string" &&
    /^[0-9a-f-]{36}$/i.test(item.leaseId) &&
    typeof item.createdAt === "number" && Number.isFinite(item.createdAt) &&
    typeof item.heartbeatAt === "number" && Number.isFinite(item.heartbeatAt) &&
    item.createdAt <= item.heartbeatAt;
}

/** Creates a private lease marker and returns a serialized, ownership-checked heartbeat operation. */
export async function createWorkspaceLease(workspaceRoot: string, now = Date.now()) {
  const workspaceId = basename(workspaceRoot);
  if (!/^job-[A-Za-z0-9_-]+$/.test(workspaceId) || !Number.isFinite(now)) {
    throw new Error("invalid_workspace_lease_target");
  }
  const rootInfo = await lstat(workspaceRoot);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error("workspace_lease_root_must_be_real_directory");
  }
  const leaseId = randomUUID();
  const lease: WorkspaceLease = { leaseId, workspaceId, createdAt: now, heartbeatAt: now };
  const path = join(workspaceRoot, LEASE_FILE);
  await writeFile(path, JSON.stringify({ version: 1, ...lease }), { flag: "wx", mode: 0o600 });

  let heartbeatQueue: Promise<void> = Promise.resolve();
  return Object.freeze({
    leaseId,
    heartbeat(at = Date.now()): Promise<void> {
      const operation = heartbeatQueue.then(async () => {
        if (!Number.isFinite(at) || at < lease.createdAt) throw new Error("invalid_workspace_heartbeat_time");
        const currentRoot = await lstat(workspaceRoot);
        if (!currentRoot.isDirectory() || currentRoot.isSymbolicLink()) {
          throw new Error("workspace_lease_root_must_be_real_directory");
        }
        const currentInfo = await lstat(path);
        if (!currentInfo.isFile() || currentInfo.isSymbolicLink() || currentInfo.size > MAX_LEASE_BYTES) {
          throw new Error("workspace_lease_marker_unavailable");
        }
        let currentValue: unknown;
        try { currentValue = JSON.parse(await readFile(path, "utf8")); }
        catch { throw new Error("workspace_lease_marker_invalid"); }
        if (!isLease(currentValue, workspaceId) || currentValue.leaseId !== leaseId) {
          throw new Error("workspace_lease_ownership_lost");
        }
        if (at < currentValue.heartbeatAt) throw new Error("workspace_heartbeat_out_of_order");
        const next = { version: 1, leaseId, workspaceId, createdAt: lease.createdAt, heartbeatAt: at };
        const temporary = join(workspaceRoot, ".lease-" + randomUUID() + ".tmp");
        try {
          await writeFile(temporary, JSON.stringify(next), { flag: "wx", mode: 0o600 });
          await rename(temporary, path);
        } finally {
          await rm(temporary, { force: true }).catch(() => undefined);
        }
      });
      heartbeatQueue = operation.catch(() => undefined);
      return operation;
    },
  });
}

/** Invalid or symlinked lease markers fail closed: the janitor must skip them. */
export async function inspectWorkspaceLease(
  workspaceRoot: string,
  now: number,
  retentionMs: number,
): Promise<WorkspaceLeaseState> {
  const workspaceId = basename(workspaceRoot);
  const path = join(workspaceRoot, LEASE_FILE);
  let info;
  try { info = await lstat(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { state: "missing" };
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_LEASE_BYTES) return { state: "invalid" };
  let value: unknown;
  try { value = JSON.parse(await readFile(path, "utf8")); }
  catch { return { state: "invalid" }; }
  if (!isLease(value, workspaceId) || value.heartbeatAt > now + FUTURE_CLOCK_SKEW_MS) {
    return { state: "invalid" };
  }
  return now - value.heartbeatAt < retentionMs
    ? { state: "active", lease: value }
    : { state: "expired", lease: value };
}
