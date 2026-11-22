import { mkdir, rmdir } from "node:fs/promises";
import { join } from "node:path";

const LOCK_NAME = ".deplo-workspace-operation-lock";

/**
 * Acquires an atomic per-workspace filesystem lock.
 * A stale lock is deliberately not auto-reclaimed: safety wins over cleanup liveness.
 */
export async function acquireWorkspaceOperationLock(workspaceRoot: string): Promise<() => Promise<void>> {
  const lockPath = join(workspaceRoot, LOCK_NAME);
  await mkdir(lockPath, { mode: 0o700 });
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await rmdir(lockPath).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
  };
}

export function isWorkspaceOperationLockBusy(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "EEXIST";
}
