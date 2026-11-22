import { chmod, lstat, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

export type BuildResourcePolicy = Readonly<{
  timeoutMs: number; memoryMb: number; cpuCores: number; diskMb: number;
  maxProcesses: number; maxOutputFiles: number; maxOutputBytes: number;
  maxLogBytes: number; network: "deny";
}>;

export const DEFAULT_BUILD_RESOURCE_POLICY: BuildResourcePolicy = Object.freeze({
  timeoutMs: 10 * 60 * 1000, memoryMb: 2048, cpuCores: 2, diskMb: 4096,
  maxProcesses: 128, maxOutputFiles: 5000, maxOutputBytes: 100 * 1024 * 1024,
  maxLogBytes: 2 * 1024 * 1024, network: "deny",
});

export type BuildWorkspace = Readonly<{
  id: string; root: string; sourceDir: string; outputDir: string; workDir: string;
  cleanup: () => Promise<void>;
}>;

export type WorkspaceManager = Readonly<{
  create: () => Promise<BuildWorkspace>;
  activeCount: () => number;
  maxActiveWorkspaces: number;
}>;

function assertSafeWorkspaceRoot(root: string): void {
  if (!isAbsolute(root) || resolve(root) !== root || root === "/") {
    throw new Error("workspace_root_must_be_absolute_canonical_and_non_root");
  }
}

/**
 * Private disposable filesystem workspaces only. Concurrency quotas here are
 * process-local admission controls, not disk quotas or OS resource isolation.
 */
export async function createWorkspaceManager(
  rootPath: string,
  options: { maxActiveWorkspaces?: number } = {},
): Promise<WorkspaceManager> {
  assertSafeWorkspaceRoot(rootPath);
  const maxActiveWorkspaces = options.maxActiveWorkspaces ?? 4;
  if (!Number.isSafeInteger(maxActiveWorkspaces) || maxActiveWorkspaces < 1 || maxActiveWorkspaces > 128) {
    throw new Error("invalid_max_active_workspaces");
  }
  const root = resolve(rootPath);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("workspace_root_must_be_a_real_directory");
  const canonicalRoot = await realpath(root);
  if (canonicalRoot !== root) throw new Error("workspace_root_must_not_resolve_through_symlinks");
  await chmod(root, 0o700);

  let active = 0;
  return Object.freeze({
    maxActiveWorkspaces,
    activeCount: () => active,
    async create(): Promise<BuildWorkspace> {
      if (active >= maxActiveWorkspaces) throw new Error("workspace_capacity_exceeded");
      active += 1;
      let workspaceRoot: string | undefined;
      try {
        workspaceRoot = await mkdtemp(join(canonicalRoot, "job-"));
        await chmod(workspaceRoot, 0o700);
        const sourceDir = join(workspaceRoot, "source");
        const outputDir = join(workspaceRoot, "output");
        const workDir = join(workspaceRoot, "work");
        for (const path of [sourceDir, outputDir, workDir]) {
          await mkdir(path, { mode: 0o700 });
          await chmod(path, 0o700);
        }
        let released = false;
        const release = () => {
          if (!released) { released = true; active -= 1; }
        };
        return Object.freeze({
          id: workspaceRoot.slice(canonicalRoot.length + 1), root: workspaceRoot,
          sourceDir, outputDir, workDir,
          async cleanup() {
            const info = await lstat(workspaceRoot!).catch(error => {
              if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
              throw error;
            });
            if (info && (!info.isDirectory() || info.isSymbolicLink() ||
                resolve(workspaceRoot!) !== workspaceRoot! ||
                !workspaceRoot!.startsWith(canonicalRoot + "/") ||
                !/^job-[A-Za-z0-9_-]+$/.test(workspaceRoot!.slice(canonicalRoot.length + 1)))) {
              throw new Error("refusing_unsafe_workspace_cleanup");
            }
            if (info) await rm(workspaceRoot!, { recursive: true, force: true });
            release();
          },
        });
      } catch (error) {
        if (workspaceRoot) await rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined);
        active -= 1;
        throw error;
      }
    },
  });
}
