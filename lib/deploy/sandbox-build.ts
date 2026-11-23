import { access, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { detectFrameworkBuildPlan, type FrameworkBuildPlan } from "./framework-detection";
import { extractTar } from "./tar-extract";
import { KEEP_ONLY_NODE_MODULES, SNAPSHOT_ID_PATTERN, type BuildCacheStore } from "./build-cache";

/** Minimal surface of @vercel/sandbox that DEPLO uses, so tests can fake it. */
export type SandboxCommandResult = { exitCode: number; output(stream?: "both" | "stdout" | "stderr"): Promise<string> };
export type SandboxInstance = {
  runCommand(params: { cmd: string; args?: string[]; env?: Record<string, string>; timeoutMs?: number }): Promise<SandboxCommandResult>;
  readFileToBuffer(params: { path: string }): Promise<Buffer | null>;
  writeFiles?(files: { path: string; content: Buffer }[]): Promise<unknown>;
  /** Saves the filesystem and stops the sandbox. */
  snapshot?(options?: { expiration?: number }): Promise<{ snapshotId: string }>;
  stop(): Promise<unknown>;
};
export type SandboxCreateOptions = {
  source?:
    | { type: "git"; url: string; depth: number; revision: string; username?: string; password?: string }
    | { type: "snapshot"; snapshotId: string };
  resources: { vcpus: number };
  timeout: number;
  persistent: boolean;
};
export type SandboxFactory = (options: SandboxCreateOptions) => Promise<SandboxInstance>;

export class SandboxBuildError extends Error {
  constructor(message: string, readonly log: string, readonly code: string) {
    super(message);
    this.name = "SandboxBuildError";
  }
}

export type SiteDecision =
  | { kind: "static" }
  | { kind: "build"; plan: FrameworkBuildPlan; outputCandidates: string[] }
  | { kind: "unsupported"; message: string };

const BUILDABLE = new Set(["vite", "react", "create-react-app", "nextjs"]);
const OUTPUT_GUESSES = ["dist", "build", "out", "public", "_site"];

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

/**
 * Decides how to publish an extracted repository:
 * - framework projects with a build script are built (even if they also have a
 *   root index.html, as Vite projects do; publishing their source would break),
 * - plain sites with a root index.html are published as they are,
 * - anything else gets a clear explanation.
 */
export async function decideSite(root: string): Promise<SiteDecision> {
  const hasIndex = await exists(join(root, "index.html"));
  if (!(await exists(join(root, "package.json")))) {
    return hasIndex ? { kind: "static" } : {
      kind: "unsupported",
      message: "No index.html or package.json was found at the repository root. Add an index.html, or a package.json with a build script.",
    };
  }
  let plan: FrameworkBuildPlan;
  try { plan = await detectFrameworkBuildPlan(root); }
  catch (error) { return { kind: "unsupported", message: error instanceof Error ? error.message : "package.json could not be read." }; }

  if (plan.framework === "nextjs" && plan.target === "managed-runtime-required") {
    return {
      kind: "unsupported",
      message: "This Next.js app needs a server. DEPLO hosts static sites, so add output: \"export\" to next.config to publish it as static files.",
    };
  }
  if (plan.buildScriptPresent && (BUILDABLE.has(plan.framework) || !hasIndex)) {
    const candidates = [plan.outputDirectory, ...OUTPUT_GUESSES].filter((value, index, list): value is string => Boolean(value) && value !== "." && list.indexOf(value) === index);
    return { kind: "build", plan, outputCandidates: candidates };
  }
  if (hasIndex) return { kind: "static" };
  return { kind: "unsupported", message: "package.json has no build script, and there is no index.html at the repository root." };
}

export function installCommand(manager: FrameworkBuildPlan["packageManager"], _hasNpmLock?: boolean): string {
  const ensure = (tool: string) => "(command -v " + tool + " >/dev/null 2>&1 || npm install -g " + tool + " --silent)";
  // Decide inside the sandbox: the clone there is what matters, and lockfiles are often not committed.
  switch (manager) {
    case "pnpm": return ensure("pnpm") + " && pnpm install --no-frozen-lockfile";
    case "yarn": return ensure("yarn") + " && yarn install --non-interactive";
    case "bun": return ensure("bun") + " && bun install";
    default: return "if [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi";
  }
}

/** Fails early, with a directory listing, when the build starts outside the project folder. */
export const PROJECT_GUARD = "if [ ! -f package.json ]; then echo \"package.json was not found in $(pwd)\" >&2; ls -la >&2; exit 2; fi";

export function sandboxBuildsAvailable(env: Record<string, string | undefined> = process.env): boolean {
  if (env.DEPLO_DISABLE_SANDBOX_BUILDS === "1") return false;
  return env.VERCEL === "1" || Boolean(env.VERCEL_OIDC_TOKEN) || Boolean(env.VERCEL_TOKEN && env.VERCEL_TEAM_ID && env.VERCEL_PROJECT_ID);
}

async function defaultFactory(options: SandboxCreateOptions): Promise<SandboxInstance> {
  const sdk = await import("@vercel/sandbox") as unknown as { Sandbox: { create(options: unknown): Promise<SandboxInstance> } };
  const credentials = process.env.VERCEL_TOKEN && process.env.VERCEL_TEAM_ID && process.env.VERCEL_PROJECT_ID
    ? { token: process.env.VERCEL_TOKEN, teamId: process.env.VERCEL_TEAM_ID, projectId: process.env.VERCEL_PROJECT_ID }
    : {};
  return sdk.Sandbox.create({ ...options, ...credentials });
}

function tail(text: string, lines = 120): string {
  const parts = text.split(/\r?\n/);
  return parts.slice(-lines).join("\n");
}

function redact(text: string, secret: string | null, extra: string[] = []): string {
  let result = secret ? text.split(secret).join("***") : text;
  for (const value of extra) if (value.length >= 4) result = result.split(value).join("***");
  return result;
}

export type SandboxBuildInput = {
  /**
   * Git source. `accessToken` is the clone credential and must be scoped to this
   * one repository (a GitHub App installation token), because the sandbox runs
   * the repository's own build scripts. Never pass a user's OAuth token.
   * Omit both and pass filesRoot or checkoutRoot to copy local files instead.
   */
  repositoryUrl?: string;
  revision?: string;
  /** Local directory whose files are copied into the sandbox (for ZIP uploads). */
  filesRoot?: string;
  /**
   * Local checkout of the repository, copied in when there is no repositoryUrl.
   * Used for private repositories without a repository-scoped token, so the
   * user's own GitHub token never enters the sandbox.
   */
  checkoutRoot?: string;
  accessToken: string | null;
  decision: Extract<SiteDecision, { kind: "build" }>;
  hasNpmLock: boolean;
  destination: string;
  factory?: SandboxFactory;
  budgetMs?: number;
  /** The project's environment variables, available to install and build commands. */
  buildEnv?: Record<string, string>;
  /**
   * Dependency cache. `key` comes from dependencyCacheKey(); `sourceRoot` is a
   * local copy of the same source, copied into a restored sandbox instead of a
   * fresh clone.
   */
  cache?: { key: string; sourceRoot: string; store: BuildCacheStore; restore?: boolean };
};

export type SandboxBuildResult = { outputDirectory: string; fileCount: number; totalBytes: number; log: string; cache: "hit" | "saved" | "miss" | "off" };

/**
 * Clones the repository into an isolated Vercel Sandbox microVM, installs
 * dependencies, runs the build script, and copies the static output back into
 * `destination`. DEPLO's own secrets never enter the sandbox; a GitHub token is
 * used only as the clone credential for the user's own repository.
 *
 * With `cache`, a build whose dependencies match the last saved snapshot starts
 * from that snapshot, gets the local source copied in (no clone, so no token in
 * the sandbox) and skips the install. A successful uncached build saves a new
 * snapshot that holds only node_modules.
 */
export async function buildInSandbox(input: SandboxBuildInput): Promise<SandboxBuildResult> {
  const started = Date.now();
  const attempt = { restored: false };
  try {
    return await runSandboxBuild(input, attempt);
  } catch (error) {
    // A restored cache differs from a fresh clone in small ways (file modes, a
    // dependency that changed outside the lockfile). If the build fails on it,
    // try once more from a clean install before reporting the failure.
    const budget = input.budgetMs ?? 250_000;
    const left = budget - (Date.now() - started);
    if (!attempt.restored || !(error instanceof SandboxBuildError) || !RETRYABLE_ON_CACHE.has(error.code) || left < 90_000) throw error;
    const retried = await runSandboxBuild({ ...input, budgetMs: left, cache: { ...input.cache!, restore: false } }, { restored: false }).catch((retryError: unknown) => {
      if (retryError instanceof SandboxBuildError) {
        throw new SandboxBuildError(retryError.message, error.log + "\n\nRetried without the dependency cache:\n" + retryError.log, retryError.code);
      }
      throw retryError;
    });
    return { ...retried, log: error.log + "\n\nThe build failed with the dependency cache, so it was retried from a clean install:\n" + retried.log };
  }
}

const RETRYABLE_ON_CACHE = new Set(["install_failed", "build_failed", "output_missing"]);

async function runSandboxBuild(input: SandboxBuildInput, attempt: { restored: boolean }): Promise<SandboxBuildResult> {
  const started = Date.now();
  const budget = input.budgetMs ?? 250_000;
  const remaining = () => Math.max(10_000, budget - (Date.now() - started));
  const log: string[] = [];
  const factory = input.factory ?? defaultFactory;
  const buildEnv = input.buildEnv ?? {};
  const envValues = Object.values(buildEnv);

  const createOptions = { resources: { vcpus: 2 }, timeout: 10 * 60 * 1000, persistent: false };
  let sandbox: SandboxInstance | null = null;
  let restored = false;
  if (input.cache?.sourceRoot && input.cache.restore !== false) {
    const entry = await input.cache.store.load().catch(() => null);
    if (entry && entry.key === input.cache.key && SNAPSHOT_ID_PATTERN.test(entry.snapshotId)) {
      try {
        sandbox = await factory({ source: { type: "snapshot", snapshotId: entry.snapshotId }, ...createOptions });
        restored = true;
        attempt.restored = true;
        log.push("Restored the dependency cache from the last build.");
      } catch {
        // Snapshots expire; fall back to a normal build.
        log.push("The dependency cache has expired; installing from scratch.");
      }
    }
  }

  if (!sandbox) try {
    sandbox = await factory({
      ...(input.repositoryUrl && input.revision ? {
        source: {
          type: "git" as const, url: input.repositoryUrl, depth: 1, revision: input.revision,
          ...(input.accessToken ? { username: "x-access-token", password: input.accessToken } : {}),
        },
      } : {}),
      ...createOptions,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    throw new SandboxBuildError("The build sandbox could not start. On Vercel this needs Sandbox access for the project (Hobby includes a free monthly quota).", redact(detail, input.accessToken), "sandbox_unavailable");
  }

  const box: SandboxInstance = sandbox;
  let snapshotted = false;
  const run = async (label: string, script: string, timeoutMs: number, env: Record<string, string> = {}) => {
    log.push("$ " + label);
    const result = await box.runCommand({ cmd: "bash", args: ["-lc", script], env: { ...buildEnv, CI: "1", ...env }, timeoutMs: Math.min(timeoutMs, remaining()) });
    const output = await result.output("both").catch(() => "");
    log.push(tail(redact(output, input.accessToken, envValues)));
    return { exitCode: result.exitCode, output };
  };

  try {
    // Source comes from a git clone, or is copied in: uploads, a local checkout, or a restored cache.
    const copyRoot = restored ? input.cache!.sourceRoot : input.filesRoot ?? (input.repositoryUrl ? undefined : input.checkoutRoot);
    if (restored) {
      const reset = await run("clear previous source", KEEP_ONLY_NODE_MODULES, 30_000);
      if (reset.exitCode !== 0) throw new SandboxBuildError("The cached build folder could not be cleared.", log.join("\n"), "build_failed");
    }
    if (copyRoot) {
      if (!box.writeFiles) throw new SandboxBuildError("This sandbox cannot receive uploaded files.", "", "sandbox_unavailable");
      // ZIP uploads drop stale dist/, build/ and out/ folders; a restored checkout keeps them, as a fresh clone would.
      const files = await collectSourceFiles(copyRoot, input.filesRoot ? UPLOAD_SKIP : CHECKOUT_SKIP);
      for (let index = 0; index < files.length; index += 200) {
        await box.writeFiles(files.slice(index, index + 200).map(({ path, content }) => ({ path, content })));
      }
      // writeFiles does not carry file modes; restore executable bits (for scripts the build runs directly).
      const executables = files.filter((file) => file.executable).map((file) => file.path);
      if (executables.length) {
        await box.writeFiles([{ path: EXECUTABLES_LIST, content: Buffer.from(executables.join("\0") + "\0") }]);
        const modes = await run("restore executable bits", "xargs -0 chmod +x -- < " + EXECUTABLES_LIST + " && rm -f " + EXECUTABLES_LIST, 30_000);
        if (modes.exitCode !== 0) throw new SandboxBuildError("Executable files could not be prepared in the sandbox.", log.join("\n"), "build_failed");
      }
      log.push("Copied " + files.length + (input.filesRoot ? " uploaded" : " source") + " files into the sandbox.");
    }
    const { plan } = input.decision;
    const freshInstall = installCommand(plan.packageManager);
    // The cache key covers package.json dependencies and lockfiles, so a restored node_modules is already current.
    const installScript = restored
      ? "if [ -d node_modules ]; then echo 'Dependencies unchanged; reusing cached node_modules.'; else " + freshInstall + "; fi"
      : freshInstall;
    const install = await run(plan.packageManager + " install", PROJECT_GUARD + " && " + installScript, 150_000);
    if (install.exitCode !== 0) throw new SandboxBuildError("Installing dependencies failed. See the build log.", log.join("\n"), "install_failed");

    const buildCmd = (plan.packageManager === "npm" ? "npm" : plan.packageManager) + " run build";
    const build = await run(buildCmd, buildCmd, 150_000);
    if (build.exitCode !== 0) throw new SandboxBuildError("The build script failed. See the build log.", log.join("\n"), "build_failed");

    const quoted = input.decision.outputCandidates.map((dir) => "'" + dir.replace(/'/g, "") + "'").join(" ");
    const pack = await run(
      "package build output",
      "for d in " + quoted + "; do if [ -f \"$d/index.html\" ]; then tar -cf /tmp/deplo-output.tar -C \"$d\" . && echo \"DEPLO_OUTPUT=$d\" && exit 0; fi; done; echo 'No build output with an index.html was found.' >&2; exit 3",
      60_000,
    );
    const outputDirectory = /DEPLO_OUTPUT=(.+)/.exec(pack.output)?.[1]?.trim();
    if (pack.exitCode !== 0 || !outputDirectory) {
      throw new SandboxBuildError("The build finished but produced no folder with an index.html (looked in " + input.decision.outputCandidates.join(", ") + ").", log.join("\n"), "output_missing");
    }

    const archive = await box.readFileToBuffer({ path: "/tmp/deplo-output.tar" });
    if (!archive) throw new SandboxBuildError("The build output could not be copied out of the sandbox.", log.join("\n"), "output_unreadable");
    const extracted = await extractTar(Buffer.from(archive), input.destination);
    log.push("Built " + plan.framework + " output from " + outputDirectory + "/ (" + extracted.fileCount + " files) in " + Math.round((Date.now() - started) / 1000) + "s.");

    let cacheResult: "hit" | "saved" | "miss" | "off" = !input.cache ? "off" : restored ? "hit" : "miss";
    const store = input.cache?.store;
    // Save only after a successful build, only when there is time left, and never
    // with source, .git (clone credentials) or build caches inside the snapshot.
    if (input.cache && store?.save && !restored && box.snapshot && budget - (Date.now() - started) > SNAPSHOT_TIME_RESERVE_MS) {
      try {
        const cleared = await run("prepare dependency cache", KEEP_ONLY_NODE_MODULES + " && rm -rf node_modules/.cache", 30_000);
        if (cleared.exitCode === 0) {
          const snapshot = await box.snapshot({ expiration: CACHE_EXPIRATION_MS });
          snapshotted = true;
          if (SNAPSHOT_ID_PATTERN.test(snapshot.snapshotId)) {
            await store.save({ key: input.cache.key, snapshotId: snapshot.snapshotId });
            cacheResult = "saved";
            log.push("Saved the dependency cache for the next build.");
          }
        }
      } catch {
        log.push("The dependency cache could not be saved; the next build will install from scratch.");
      }
    }
    return { outputDirectory, ...extracted, log: log.join("\n"), cache: cacheResult };
  } catch (error) {
    if (error instanceof SandboxBuildError) throw error;
    throw new SandboxBuildError(error instanceof Error ? error.message : "The build failed.", log.join("\n"), "build_failed");
  } finally {
    if (!snapshotted) await box.stop().catch(() => undefined);
  }
}

/** Snapshots are kept for 7 days after their last use. */
const CACHE_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000;
/** Time a snapshot needs; skip saving the cache when the request is close to its limit. */
const SNAPSHOT_TIME_RESERVE_MS = 45_000;

const EXECUTABLES_LIST = ".deplo-executables";
const UPLOAD_SKIP = new Set(["node_modules", ".git", "__MACOSX", ".DS_Store", ".next", "dist", "build", "out"]);
const CHECKOUT_SKIP = new Set(["node_modules", ".git", "__MACOSX", ".DS_Store"]);

/** Reads an uploaded project's source files (not dependencies or old build output) for the sandbox. */
export type SourceFile = { path: string; content: Buffer; executable: boolean };

export async function collectSourceFiles(root: string, skip: ReadonlySet<string> = UPLOAD_SKIP): Promise<SourceFile[]> {
  const files: SourceFile[] = [];
  const walk = async (directory: string, prefix: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (skip.has(entry.name) || entry.isSymbolicLink()) continue;
      const full = join(directory, entry.name);
      const relative = prefix ? prefix + "/" + entry.name : entry.name;
      if (entry.isDirectory()) await walk(full, relative);
      else if (entry.isFile()) {
        const mode = (await stat(full)).mode;
        files.push({ path: relative, content: await readFile(full), executable: (mode & 0o100) !== 0 });
      }
    }
  };
  await walk(root, "");
  return files;
}

export async function hasPackageLock(root: string): Promise<boolean> {
  return exists(join(root, "package-lock.json"));
}
