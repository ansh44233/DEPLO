import { skipWithoutSymlinks } from "../helpers/platform";
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractTar } from "../../lib/deploy/tar-extract";
import { buildInSandbox, decideSite, installCommand, sandboxBuildsAvailable, SandboxBuildError, type SandboxCreateOptions, type SandboxFactory } from "../../lib/deploy/sandbox-build";

async function tempDir(prefix: string) { return mkdtemp(join(tmpdir(), prefix)); }

async function makeTar(build: (dir: string) => Promise<void>, extraArgs: string[] = []): Promise<Buffer> {
  const dir = await tempDir("deplo-tar-src-");
  await build(dir);
  const outDir = await tempDir("deplo-tar-out-");
  // A relative archive name keeps GNU tar on Windows from reading "C:" as a remote host.
  execFileSync("tar", ["-cf", "out.tar", ...extraArgs, "-C", dir, "."], { cwd: outDir });
  return readFile(join(outDir, "out.tar"));
}

test("extracts a real tar archive including long GNU names and skips symlinks", { skip: skipWithoutSymlinks }, async () => {
  const longName = "a".repeat(120) + "/" + "b".repeat(120) + ".js";
  const archive = await makeTar(async (dir) => {
    await writeFile(join(dir, "index.html"), "<!doctype html><title>x</title>");
    await mkdir(join(dir, "assets"));
    await writeFile(join(dir, "assets", "app.js"), "console.log(1)");
    await mkdir(join(dir, "a".repeat(120)));
    await writeFile(join(dir, longName), "long");
    await symlink("/etc/passwd", join(dir, "leak"));
  });
  const dest = await tempDir("deplo-tar-dest-");
  try {
    const result = await extractTar(archive, dest);
    assert.equal(result.fileCount, 3);
    assert.equal(await readFile(join(dest, "assets", "app.js"), "utf8"), "console.log(1)");
    assert.equal(await readFile(join(dest, longName), "utf8"), "long");
    await assert.rejects(stat(join(dest, "leak")));
  } finally { await rm(dest, { recursive: true, force: true }); }
});

test("rejects path traversal in tar entries", async () => {
  const header = Buffer.alloc(512);
  header.write("../escape.txt", 0);
  header.write("0000644\0", 100); header.write("0000000\0", 108); header.write("0000000\0", 116);
  header.write("00000000005\0", 124); header.write("00000000000\0", 136);
  header[156] = 48;
  const archive = Buffer.concat([header, Buffer.from("hello"), Buffer.alloc(507), Buffer.alloc(1024)]);
  const dest = await tempDir("deplo-tar-evil-");
  try { await assert.rejects(extractTar(archive, dest), /unsafe path/); }
  finally { await rm(dest, { recursive: true, force: true }); }
});

async function repo(files: Record<string, string>) {
  const dir = await tempDir("deplo-repo-");
  for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content);
  return dir;
}

test("decides how to publish each kind of repository", async () => {
  const vite = await repo({ "index.html": "<!doctype html>", "package.json": JSON.stringify({ scripts: { build: "vite build" }, devDependencies: { vite: "^5" } }) });
  const vd = await decideSite(vite);
  assert.equal(vd.kind, "build", "Vite projects are built even though they have a root index.html");
  if (vd.kind === "build") assert.equal(vd.outputCandidates[0], "dist");

  assert.equal((await decideSite(await repo({ "index.html": "<!doctype html>" }))).kind, "static");
  assert.equal((await decideSite(await repo({ "index.html": "x", "package.json": JSON.stringify({ devDependencies: { prettier: "^3" } }) }))).kind, "static");

  const ssr = await decideSite(await repo({ "package.json": JSON.stringify({ scripts: { build: "next build" }, dependencies: { next: "15" } }) }));
  assert.equal(ssr.kind, "unsupported");
  if (ssr.kind === "unsupported") assert.match(ssr.message, /output: "export"/);

  const exported = await decideSite(await repo({ "next.config.mjs": "export default { output: 'export' }", "package.json": JSON.stringify({ scripts: { build: "next build" }, dependencies: { next: "15" } }) }));
  assert.equal(exported.kind, "build");
  if (exported.kind === "build") assert.equal(exported.outputCandidates[0], "out");

  assert.equal((await decideSite(await repo({ "README.md": "hi" }))).kind, "unsupported");
});

test("picks install commands per package manager", () => {
  // npm picks ci or install inside the sandbox, based on the lockfile that is actually there.
  assert.match(installCommand("npm"), /^if \[ -f package-lock\.json \] \|\| \[ -f npm-shrinkwrap\.json \]; then npm ci .*; else npm install .*; fi$/);
  assert.match(installCommand("pnpm", false), /npm install -g pnpm.*pnpm install/);
  assert.match(installCommand("bun", false), /bun install$/);
});

test("sandbox builds are available on Vercel or with an access token", () => {
  assert.equal(sandboxBuildsAvailable({ VERCEL: "1" }), true);
  assert.equal(sandboxBuildsAvailable({ VERCEL_TOKEN: "t", VERCEL_TEAM_ID: "team", VERCEL_PROJECT_ID: "prj" }), true);
  assert.equal(sandboxBuildsAvailable({}), false);
  assert.equal(sandboxBuildsAvailable({ VERCEL: "1", DEPLO_DISABLE_SANDBOX_BUILDS: "1" }), false);
});

function fakeSandbox(outputTar: Buffer | null, overrides: { installExit?: number; buildExit?: number; packExit?: number; output?: string } = {}) {
  const calls: { script: string; env?: Record<string, string> }[] = [];
  let created: SandboxCreateOptions | undefined;
  let stopped = false;
  const factory: SandboxFactory = async (options) => {
    created = options;
    return {
      async runCommand({ args, env }) {
        const script = args?.[1] ?? "";
        calls.push({ script, env });
        const exitCode = /install/.test(script) && !/tar/.test(script) ? overrides.installExit ?? 0
          : /run build/.test(script) ? overrides.buildExit ?? 0
          : overrides.packExit ?? 0;
        const text = /tar -cf/.test(script) ? (exitCode === 0 ? "DEPLO_OUTPUT=dist\n" : "") : overrides.output ?? "ok using token ghs_secret";
        return { exitCode, output: async () => text };
      },
      async readFileToBuffer() { return outputTar; },
      async stop() { stopped = true; },
    };
  };
  return { factory, calls, get created() { return created; }, get stopped() { return stopped; } };
}

const viteDecision = { kind: "build" as const, outputCandidates: ["dist", "build"], plan: {
  framework: "vite" as const, packageManager: "npm" as const, buildScriptPresent: true, buildCommand: "npm run build",
  outputDirectory: "dist", target: "cloudflare-pages-static" as const, requiresIsolatedRunner: true as const, executed: false as const, reason: "",
} };

test("builds in the sandbox and extracts the output", async () => {
  const tarball = await makeTar(async (dir) => { await writeFile(join(dir, "index.html"), "<!doctype html>built"); });
  const fake = fakeSandbox(tarball);
  const dest = await tempDir("deplo-build-out-");
  try {
    const result = await buildInSandbox({ repositoryUrl: "https://github.com/o/r.git", revision: "main", accessToken: "ghs_secret", decision: viteDecision, hasNpmLock: true, destination: dest, factory: fake.factory });
    assert.equal(result.outputDirectory, "dist");
    assert.equal(await readFile(join(dest, "index.html"), "utf8"), "<!doctype html>built");
    assert.deepEqual(fake.created?.source, { type: "git", url: "https://github.com/o/r.git", depth: 1, revision: "main", username: "x-access-token", password: "ghs_secret" });
    assert.equal(fake.created?.persistent, false);
    assert.deepEqual(fake.calls.map((call) => call.script.split(" ")[0]), ["if", "npm", "for"]);
    assert.match(fake.calls[0].script, /package\.json was not found/);
    assert.equal(fake.calls.every((call) => !JSON.stringify(call.env).includes("SUPABASE")), true);
    assert.equal(result.log.includes("ghs_secret"), false, "tokens are redacted from build logs");
    assert.equal(fake.stopped, true);
  } finally { await rm(dest, { recursive: true, force: true }); }
});

test("reports install, build and missing-output failures with the log and stops the sandbox", async () => {
  for (const [overrides, code] of [[{ installExit: 1 }, "install_failed"], [{ buildExit: 2 }, "build_failed"], [{ packExit: 3 }, "output_missing"]] as const) {
    const fake = fakeSandbox(null, { ...overrides, output: "Error: Cannot find module 'react'" });
    await assert.rejects(
      buildInSandbox({ repositoryUrl: "https://github.com/o/r.git", revision: "main", accessToken: null, decision: viteDecision, hasNpmLock: false, destination: await tempDir("deplo-x-"), factory: fake.factory }),
      (error: unknown) => {
        assert.ok(error instanceof SandboxBuildError);
        assert.equal(error.code, code);
        assert.match(error.log, /Cannot find module 'react'/);
        return true;
      },
    );
    assert.equal(fake.stopped, true);
  }
});

test("explains when the sandbox cannot start", async () => {
  const factory: SandboxFactory = async () => { throw new Error("401 missing OIDC token"); };
  await assert.rejects(
    buildInSandbox({ repositoryUrl: "https://github.com/o/r.git", revision: "main", accessToken: null, decision: viteDecision, hasNpmLock: false, destination: await tempDir("deplo-y-"), factory }),
    (error: unknown) => error instanceof SandboxBuildError && error.code === "sandbox_unavailable",
  );
});

test("passes project environment variables to install and build, and hides their values in the log", async () => {
  const tarball = await makeTar(async (dir) => { await writeFile(join(dir, "index.html"), "ok"); });
  const fake = fakeSandbox(tarball, { output: "using VITE_API_KEY=sk_live_secret_value" });
  const dest = await tempDir("deplo-build-env-");
  try {
    const result = await buildInSandbox({ repositoryUrl: "https://github.com/o/r.git", revision: "main", accessToken: null, decision: viteDecision, hasNpmLock: true, destination: dest, factory: fake.factory, buildEnv: { VITE_API_KEY: "sk_live_secret_value", CI: "0" } });
    assert.equal(fake.calls[0].env?.VITE_API_KEY, "sk_live_secret_value");
    assert.equal(fake.calls[1].env?.VITE_API_KEY, "sk_live_secret_value");
    assert.equal(fake.calls[1].env?.CI, "1", "DEPLO keeps CI=1 for non-interactive builds");
    assert.equal(result.log.includes("sk_live_secret_value"), false);
    assert.match(result.log, /VITE_API_KEY=\*\*\*/);
  } finally { await rm(dest, { recursive: true, force: true }); }
});

test("builds uploaded files (no git) by copying the source but not node_modules or old builds", async () => {
  const src = await tempDir("deplo-upload-src-");
  await writeFile(join(src, "package.json"), "{}");
  await writeFile(join(src, "index.html"), "<div id=root>");
  await mkdir(join(src, "src")); await writeFile(join(src, "src", "main.tsx"), "x");
  await mkdir(join(src, "node_modules", "react"), { recursive: true }); await writeFile(join(src, "node_modules", "react", "i.js"), "x");
  await mkdir(join(src, "dist")); await writeFile(join(src, "dist", "old.js"), "x");
  const tarball = await makeTar(async (dir) => { await writeFile(join(dir, "index.html"), "built"); });
  const written: string[] = [];
  const fake = fakeSandbox(tarball);
  const factory: SandboxFactory = async (options) => {
    const instance = await fake.factory(options);
    return { ...instance, async writeFiles(files) { written.push(...files.map((file) => file.path)); } };
  };
  const dest = await tempDir("deplo-upload-out-");
  try {
    await buildInSandbox({ filesRoot: src, accessToken: null, decision: viteDecision, hasNpmLock: false, destination: dest, factory });
    assert.equal(fake.created?.source, undefined, "no git source for uploads");
    assert.deepEqual(written.sort(), ["index.html", "package.json", "src/main.tsx"]);
    assert.equal(await readFile(join(dest, "index.html"), "utf8"), "built");
  } finally { await rm(dest, { recursive: true, force: true }); }
});
