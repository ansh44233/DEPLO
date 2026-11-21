import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectFrameworkBuildPlan } from "../../lib/deploy/framework-detection";

async function withProject(files: Record<string, string>, run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "deplo-framework-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      const path = join(root, name);
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, content);
    }
    await run(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("detects Vite and package manager without executing package scripts", async () => {
  await withProject({
    "package.json": JSON.stringify({ devDependencies: { vite: "^6", react: "^19" }, scripts: { build: "vite build && echo unsafe" } }),
    "pnpm-lock.yaml": "lockfileVersion: '9.0'",
  }, async (root) => {
    const plan = await detectFrameworkBuildPlan(root);
    assert.equal(plan.framework, "vite");
    assert.equal(plan.packageManager, "pnpm");
    assert.equal(plan.buildCommand, "pnpm run build");
    assert.equal(plan.outputDirectory, "dist");
    assert.equal(plan.target, "cloudflare-pages-static");
    assert.equal(plan.executed, false);
    assert.equal(plan.requiresIsolatedRunner, true);
  });
});

test("classifies Next.js without static export as requiring a managed runtime", async () => {
  await withProject({ "package.json": JSON.stringify({ dependencies: { next: "^15", react: "^19" }, scripts: { build: "next build" } }) }, async (root) => {
    const plan = await detectFrameworkBuildPlan(root);
    assert.equal(plan.framework, "nextjs");
    assert.equal(plan.target, "managed-runtime-required");
    assert.equal(plan.outputDirectory, null);
  });
});

test("recognizes Next.js static export from config text without importing it", async () => {
  await withProject({
    "package.json": JSON.stringify({ dependencies: { next: "^15", react: "^19" }, scripts: { build: "next build" } }),
    "next.config.mjs": 'const config = { output: "export" }; export default config;',
  }, async (root) => {
    const plan = await detectFrameworkBuildPlan(root);
    assert.equal(plan.target, "cloudflare-pages-static");
    assert.equal(plan.outputDirectory, "out");
  });
});

test("does not infer a build when no build script exists", async () => {
  await withProject({ "package.json": JSON.stringify({ dependencies: { vite: "^6" }, scripts: { dev: "vite" } }) }, async (root) => {
    const plan = await detectFrameworkBuildPlan(root);
    assert.equal(plan.buildScriptPresent, false);
    assert.equal(plan.buildCommand, null);
    assert.equal(plan.target, "manual-review");
  });
});

test("rejects malformed package manifests", async () => {
  await withProject({ "package.json": "{not-json" }, async (root) => {
    await assert.rejects(detectFrameworkBuildPlan(root), /not valid JSON/);
  });
});

test("keeps plain HTML projects on the existing static path", async () => {
  await withProject({ "index.html": "<!doctype html><title>hello</title>" }, async (root) => {
    const plan = await detectFrameworkBuildPlan(root);
    assert.equal(plan.framework, "static");
    assert.equal(plan.target, "cloudflare-pages-static");
    assert.equal(plan.executed, false);
  });
});
