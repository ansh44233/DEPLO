import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FrameworkBuildPlan } from "./framework-detection";

/**
 * Dependency cache for sandbox builds.
 *
 * After a successful build DEPLO snapshots the sandbox with only
 * `node_modules` left in the project folder. The next build of the same
 * project starts from that snapshot when its dependencies are unchanged, copies
 * the new source in, and skips the install step.
 */

/** Snapshot entry saved for one project. */
export type BuildCacheEntry = { key: string; snapshotId: string };

/** Where a project's cache entry lives. `save` is omitted for read-only use (pull request previews). */
export type BuildCacheStore = {
  load(): Promise<BuildCacheEntry | null>;
  save?(entry: BuildCacheEntry): Promise<void>;
};

/** Bump to invalidate every saved cache, e.g. when the sandbox image or install commands change. */
const CACHE_FORMAT = "deplo-deps-v1";

const LOCKFILES = ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"];
const MONOREPO_MARKERS = ["pnpm-workspace.yaml", "lerna.json", "nx.json", "turbo.json", "rush.json"];
const DEPENDENCY_FIELDS = [
  "dependencies", "devDependencies", "optionalDependencies", "peerDependencies",
  "overrides", "resolutions", "pnpm", "packageManager", "engines",
];

export const SNAPSHOT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
export const CACHE_KEY_PATTERN = /^[a-f0-9]{64}$/;

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

/**
 * Hashes everything that decides what ends up in `node_modules`: the package
 * manager, the dependency fields of package.json (not scripts or version), every
 * lockfile, and the names of the project's build variables (some install
 * scripts read them). Returns null for monorepos, whose workspace packages
 * live outside `node_modules` and would not survive the snapshot.
 */
export async function dependencyCacheKey(
  root: string,
  packageManager: FrameworkBuildPlan["packageManager"],
  buildEnvNames: readonly string[] = [],
): Promise<string | null> {
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return null;
  if (manifest.workspaces !== undefined) return null;
  for (const marker of MONOREPO_MARKERS) if (await exists(join(root, marker))) return null;

  const hash = createHash("sha256");
  hash.update(CACHE_FORMAT + "\0" + packageManager + "\0");
  const dependencyFields: Record<string, unknown> = {};
  for (const field of DEPENDENCY_FIELDS) if (manifest[field] !== undefined) dependencyFields[field] = manifest[field];
  hash.update(stableJson(dependencyFields) + "\0");
  for (const name of LOCKFILES) {
    const content = await readFile(join(root, name)).catch(() => null);
    hash.update(name + ":" + (content ? createHash("sha256").update(content).digest("hex") : "-") + "\0");
  }
  hash.update([...buildEnvNames].sort().join(","));
  return hash.digest("hex");
}

/** JSON with sorted object keys, so key order in package.json does not change the hash. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + stableJson((value as Record<string, unknown>)[key])).join(",") + "}";
  }
  return JSON.stringify(value) ?? "null";
}

/** Shell step that empties the project folder except for node_modules. */
export const KEEP_ONLY_NODE_MODULES = "find . -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} +";
