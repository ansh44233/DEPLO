import { lstat, readdir, rm, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

export const MAX_PAGES_FILES = 2_000;
export const MAX_PAGES_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_PAGES_TOTAL_BYTES = 100 * 1024 * 1024;

const FORBIDDEN_SEGMENTS = new Set([
  ".git",
  ".ssh",
  ".aws",
  ".npmrc",
  ".netrc",
  ".env",
  ".yarnrc",
  "id_rsa",
  "id_ed25519",
  "authorized_keys",
  "known_hosts",
]);

export function isForbiddenStaticPath(path: string): boolean {
  return path.split(/[\\/]+/).some((segment) =>
    FORBIDDEN_SEGMENTS.has(segment.toLowerCase()) ||
    /^\.env\./i.test(segment) ||
    /^\.npmrc\./i.test(segment),
  );
}

export function validatePagesFileSize(size: number): string | null {
  if (!Number.isSafeInteger(size) || size < 0) return "Static asset size is invalid.";
  if (size > MAX_PAGES_FILE_BYTES) return "Cloudflare Pages files must be 25 MiB or smaller.";
  return null;
}

export async function inspectStaticDirectory(root: string): Promise<{ fileCount: number; totalBytes: number }> {
  const absoluteRoot = resolve(root);
  const rootStats = await lstat(absoluteRoot);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error("The static deployment root must be a real directory.");
  }

  let fileCount = 0;
  let totalBytes = 0;

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(directory, entry.name);
      const relativePath = relative(absoluteRoot, fullPath).split(sep).join("/");
      if (isForbiddenStaticPath(relativePath)) {
        throw new Error(`Deployment contains a private or blocked path: ${relativePath}`);
      }
      if (entry.isSymbolicLink()) throw new Error("Static deployments cannot contain symbolic links.");
      if (entry.isDirectory()) {
        await visit(fullPath);
        continue;
      }
      if (!entry.isFile()) throw new Error("Static deployments can contain regular files and directories only.");

      const details = await stat(fullPath);
      const sizeError = validatePagesFileSize(details.size);
      if (sizeError) throw new Error(sizeError);

      fileCount += 1;
      totalBytes += details.size;
      if (fileCount > MAX_PAGES_FILES) throw new Error("This deployment contains too many files.");
      if (totalBytes > MAX_PAGES_TOTAL_BYTES) throw new Error("The static deployment exceeds the 100 MiB total limit.");
    }
  }

  await visit(absoluteRoot);
  if (fileCount === 0) throw new Error("The deployment directory is empty.");
  return { fileCount, totalBytes };
}

const SKIPPED_SEGMENTS = new Set(["node_modules", ".DS_Store", "Thumbs.db", "__MACOSX"]);

/**
 * Removes files that must never be published (secrets such as .env files and
 * keys, VCS metadata, node_modules, symlinks) from a disposable working copy,
 * so a repository that happens to contain them still deploys safely.
 * Returns the relative paths that were removed.
 */
export async function pruneUnpublishableFiles(root: string): Promise<string[]> {
  const absoluteRoot = resolve(root);
  const removed: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(directory, entry.name);
      const relativePath = relative(absoluteRoot, fullPath).split(sep).join("/");
      if (entry.isSymbolicLink() || SKIPPED_SEGMENTS.has(entry.name) || isForbiddenStaticPath(relativePath)) {
        await rm(fullPath, { recursive: true, force: true });
        removed.push(relativePath + (entry.isDirectory() ? "/" : ""));
        continue;
      }
      if (entry.isDirectory()) await visit(fullPath);
    }
  }
  await visit(absoluteRoot);
  return removed;
}
