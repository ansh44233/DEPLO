import { chmod, lstat, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

export type BuildResourcePolicy = Readonly<{
  timeoutMs: number;
  memoryMb: number;
  cpuCores: number;
  diskMb: number;
  maxProcesses: number;
  maxOutputFiles: number;
  maxOutputBytes: number;
  maxLogBytes: number;
  network: "deny";
}>;

export const DEFAULT_BUILD_RESOURCE_POLICY: BuildResourcePolicy = Object.freeze({
  timeoutMs: 10 * 60 * 1000,
  memoryMb: 2048,
  cpuCores: 2,
  diskMb: 4096,
  maxProcesses: 128,
  maxOutputFiles: 5000,
  maxOutputBytes: 100 * 1024 * 1024,
  maxLogBytes: 2 * 1024 * 1024,
  network: "deny",
});

export type BuildWorkspace = Readonly<{
  id: string;
  root: string;
  sourceDir: string;
  outputDir: string;
  workDir: string;
  cleanup: () => Promise<void>;
}>;

export type WorkspaceManager = Readonly<{
  create: () => Promise<BuildWorkspace>;
}>;

function assertSafeWorkspaceRoot(root: string): void {
  if (!isAbsolute(root) || resolve(root) !== root || root === "/") {
    throw new Error("workspace_root_must_be_absolute_canonical_and_non_root");
  }
}

/**
 * Creates private, disposable filesystem workspaces only. This module does not
 * start processes or provide OS-level sandboxing/resource enforcement.
 */
export async function createWorkspaceManager(rootPath: string): Promise<WorkspaceManager> {
  const root = resolve(rootPath);
  assertSafeWorkspaceRoot(root);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error("workspace_root_must_be_a_real_directory");
  }
  const canonicalRoot = await realpath(root);
  if (canonicalRoot !== root) throw new Error("workspace_root_must_not_resolve_through_symlinks");
  await chmod(root, 0o700);

  return Object.freeze({
    async create(): Promise<BuildWorkspace> {
      const workspaceRoot = await mkdtemp(join(canonicalRoot, "job-"));
      await chmod(workspaceRoot, 0o700);
      const sourceDir = join(workspaceRoot, "source");
      const outputDir = join(workspaceRoot, "output");
      const workDir = join(workspaceRoot, "work");
      try {
        for (const path of [sourceDir, outputDir, workDir]) {
          await mkdir(path, { mode: 0o700 });
          await chmod(path, 0o700);
        }
      } catch (error) {
        await rm(workspaceRoot, { recursive: true, force: true });
        throw error;
      }

      let cleaned = false;
      return Object.freeze({
        id: workspaceRoot.slice(canonicalRoot.length + 1),
        root: workspaceRoot,
        sourceDir,
        outputDir,
        workDir,
        async cleanup() {
          if (cleaned) return;
          cleaned = true;
          const info = await lstat(workspaceRoot).catch(error => {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
            throw error;
          });
          if (!info) return;
          if (!info.isDirectory() || info.isSymbolicLink() ||
              resolve(workspaceRoot) !== workspaceRoot ||
              !workspaceRoot.startsWith(canonicalRoot + "/") ||
              !/^job-[A-Za-z0-9_-]+$/.test(workspaceRoot.slice(canonicalRoot.length + 1))) {
            throw new Error("refusing_unsafe_workspace_cleanup");
          }
          await rm(workspaceRoot, { recursive: true, force: true });
        },
      });
    },
  });
}
