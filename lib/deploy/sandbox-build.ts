import { access } from "node:fs/promises";
import { join } from "node:path";
import { detectFrameworkBuildPlan, type FrameworkBuildPlan } from "./framework-detection";
import { extractTar } from "./tar-extract";

/** Minimal surface of @vercel/sandbox that DEPLO uses, so tests can fake it. */
export type SandboxCommandResult = { exitCode: number; output(stream?: "both" | "stdout" | "stderr"): Promise<string> };
export type SandboxInstance = {
  runCommand(params: { cmd: string; args?: string[]; env?: Record<string, string>; timeoutMs?: number }): Promise<SandboxCommandResult>;
  readFileToBuffer(params: { path: string }): Promise<Buffer | null>;
  stop(): Promise<unknown>;
};
export type SandboxCreateOptions = {
  source: { type: "git"; url: string; depth: number; revision: string; username?: string; password?: string };
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

export function installCommand(manager: FrameworkBuildPlan["packageManager"], hasNpmLock: boolean): string {
  const ensure = (tool: string) => "(command -v " + tool + " >/dev/null 2>&1 || npm install -g " + tool + " --silent)";
  switch (manager) {
    case "pnpm": return ensure("pnpm") + " && pnpm install --no-frozen-lockfile";
    case "yarn": return ensure("yarn") + " && yarn install --non-interactive";
    case "bun": return ensure("bun") + " && bun install";
    default: return hasNpmLock ? "npm ci --no-audit --no-fund" : "npm install --no-audit --no-fund";
  }
}

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

function redact(text: string, secret: string | null): string {
  return secret ? text.split(secret).join("***") : text;
}

/**
 * Clones the repository into an isolated Vercel Sandbox microVM, installs
 * dependencies, runs the build script, and copies the static output back into
 * `destination`. DEPLO's own secrets never enter the sandbox; a GitHub token is
 * used only as the clone credential for the user's own repository.
 */
export async function buildInSandbox(input: {
  repositoryUrl: string;
  revision: string;
  accessToken: string | null;
  decision: Extract<SiteDecision, { kind: "build" }>;
  hasNpmLock: boolean;
  destination: string;
  factory?: SandboxFactory;
  budgetMs?: number;
}): Promise<{ outputDirectory: string; fileCount: number; totalBytes: number; log: string }> {
  const started = Date.now();
  const budget = input.budgetMs ?? 250_000;
  const remaining = () => Math.max(10_000, budget - (Date.now() - started));
  const log: string[] = [];
  const factory = input.factory ?? defaultFactory;

  let sandbox: SandboxInstance;
  try {
    sandbox = await factory({
      source: {
        type: "git", url: input.repositoryUrl, depth: 1, revision: input.revision,
        ...(input.accessToken ? { username: "x-access-token", password: input.accessToken } : {}),
      },
      resources: { vcpus: 2 },
      timeout: 10 * 60 * 1000,
      persistent: false,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    throw new SandboxBuildError("The build sandbox could not start. On Vercel this needs Sandbox access for the project (Hobby includes a free monthly quota).", redact(detail, input.accessToken), "sandbox_unavailable");
  }

  const run = async (label: string, script: string, timeoutMs: number, env: Record<string, string> = {}) => {
    log.push("$ " + label);
    const result = await sandbox.runCommand({ cmd: "bash", args: ["-lc", script], env: { CI: "1", ...env }, timeoutMs: Math.min(timeoutMs, remaining()) });
    const output = await result.output("both").catch(() => "");
    log.push(tail(redact(output, input.accessToken)));
    return { exitCode: result.exitCode, output };
  };

  try {
    const { plan } = input.decision;
    const install = await run(installCommand(plan.packageManager, input.hasNpmLock), installCommand(plan.packageManager, input.hasNpmLock), 150_000);
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

    const archive = await sandbox.readFileToBuffer({ path: "/tmp/deplo-output.tar" });
    if (!archive) throw new SandboxBuildError("The build output could not be copied out of the sandbox.", log.join("\n"), "output_unreadable");
    const extracted = await extractTar(Buffer.from(archive), input.destination);
    log.push("Built " + plan.framework + " output from " + outputDirectory + "/ (" + extracted.fileCount + " files) in " + Math.round((Date.now() - started) / 1000) + "s.");
    return { outputDirectory, ...extracted, log: log.join("\n") };
  } catch (error) {
    if (error instanceof SandboxBuildError) throw error;
    throw new SandboxBuildError(error instanceof Error ? error.message : "The build failed.", log.join("\n"), "build_failed");
  } finally {
    await sandbox.stop().catch(() => undefined);
  }
}

export async function hasPackageLock(root: string): Promise<boolean> {
  return exists(join(root, "package-lock.json"));
}
