import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

export type DetectedFramework = "nextjs" | "vite" | "create-react-app" | "react" | "static" | "unknown";
export type BuildPackageManager = "npm" | "pnpm" | "yarn" | "bun";
export type FrameworkBuildPlan = {
  framework: DetectedFramework;
  packageManager: BuildPackageManager;
  buildScriptPresent: boolean;
  buildCommand: string | null;
  outputDirectory: string | null;
  target: "cloudflare-pages-static" | "managed-runtime-required" | "manual-review";
  requiresIsolatedRunner: true;
  executed: false;
  reason: string;
};

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

async function detectPackageManager(root: string): Promise<BuildPackageManager> {
  for (const [file, manager] of [
    ["pnpm-lock.yaml", "pnpm"], ["yarn.lock", "yarn"], ["bun.lockb", "bun"],
    ["bun.lock", "bun"], ["package-lock.json", "npm"],
  ] as const) if (await exists(join(root, file))) return manager;
  return "npm";
}

/** Inspects metadata only. It never imports config files, installs packages, or executes scripts. */
export async function detectFrameworkBuildPlan(root: string): Promise<FrameworkBuildPlan> {
  const manifestPath = join(root, "package.json");
  if (!(await exists(manifestPath))) {
    const hasIndex = await exists(join(root, "index.html"));
    return {
      framework: hasIndex ? "static" : "unknown", packageManager: "npm",
      buildScriptPresent: false, buildCommand: null, outputDirectory: hasIndex ? "." : null,
      target: hasIndex ? "cloudflare-pages-static" : "manual-review",
      requiresIsolatedRunner: true, executed: false,
      reason: hasIndex ? "A root index.html was found; use the existing static publishing path." : "No package.json or root index.html was found.",
    };
  }

  let parsed: unknown;
  try { parsed = JSON.parse(await readFile(manifestPath, "utf8")); }
  catch { throw new Error("The project package.json is not valid JSON."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("The project package.json must contain a JSON object.");

  const manifest = parsed as { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown>; scripts?: Record<string, unknown> };
  const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
  const buildScriptPresent = typeof manifest.scripts?.build === "string" && manifest.scripts.build.trim().length > 0;
  const packageManager = await detectPackageManager(root);
  const framework: DetectedFramework = "next" in dependencies ? "nextjs"
    : "vite" in dependencies ? "vite"
    : "react" in dependencies && "@craco/craco" in dependencies ? "create-react-app"
    : "react" in dependencies ? "react"
    : await exists(join(root, "index.html")) ? "static" : "unknown";

  if (!buildScriptPresent) return {
    framework, packageManager, buildScriptPresent: false, buildCommand: null, outputDirectory: null,
    target: "manual-review", requiresIsolatedRunner: true, executed: false,
    reason: "No build script is declared. DEPLO did not run any project code.",
  };

  if (framework === "nextjs") {
    let staticExport = false;
    for (const file of ["next.config.js", "next.config.mjs", "next.config.ts", "next.config.cjs"]) {
      if (await exists(join(root, file))) {
        const configText = await readFile(join(root, file), "utf8");
        if (/\boutput\s*:\s*["']export["']/.test(configText)) staticExport = true;
      }
    }
    return {
      framework, packageManager, buildScriptPresent, buildCommand: packageManager + " run build",
      outputDirectory: staticExport ? "out" : null,
      target: staticExport ? "cloudflare-pages-static" : "managed-runtime-required",
      requiresIsolatedRunner: true, executed: false,
      reason: staticExport
        ? "Next.js static export appears configured. Config was inspected as text only; a sandboxed build is still required."
        : "Next.js may require a server runtime; static Cloudflare Pages publishing cannot host a general SSR build.",
    };
  }

  const outputDirectory = framework === "vite" ? "dist"
    : framework === "create-react-app" || framework === "react" ? "build" : null;
  return {
    framework, packageManager, buildScriptPresent, buildCommand: packageManager + " run build",
    outputDirectory, target: outputDirectory ? "cloudflare-pages-static" : "manual-review",
    requiresIsolatedRunner: true, executed: false,
    reason: outputDirectory
      ? "Framework metadata suggests a static output directory. A sandboxed build is required before publishing."
      : "The project build output cannot be inferred safely from its manifest.",
  };
}
