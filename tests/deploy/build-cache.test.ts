import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dependencyCacheKey, type BuildCacheEntry, type BuildCacheStore } from "../../lib/deploy/build-cache";
import { buildInSandbox, SandboxBuildError, type SandboxCreateOptions, type SandboxFactory } from "../../lib/deploy/sandbox-build";
import { supabaseBuildCache } from "../../lib/db/supabase-build-cache";

async function tempDir(prefix: string) { return mkdtemp(join(tmpdir(), prefix)); }

async function project(files: Record<string, string>): Promise<string> {
  const root = await tempDir("deplo-cache-src-");
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

async function outputTar(): Promise<Buffer> {
  const dir = await tempDir("deplo-cache-tar-");
  await writeFile(join(dir, "index.html"), "built");
  const out = await tempDir("deplo-cache-tarout-");
  execFileSync("tar", ["-cf", "out.tar", "-C", dir, "."], { cwd: out });
  return readFile(join(out, "out.tar"));
}

const viteDecision = { kind: "build" as const, outputCandidates: ["dist"], plan: {
  framework: "vite" as const, packageManager: "npm" as const, buildScriptPresent: true, buildCommand: "npm run build",
  outputDirectory: "dist", target: "cloudflare-pages-static" as const, requiresIsolatedRunner: true as const, executed: false as const, reason: "",
} };

function memoryStore(initial: BuildCacheEntry | null = null, readOnly = false) {
  const state = { entry: initial, saves: 0 };
  const store: BuildCacheStore = { async load() { return state.entry; } };
  if (!readOnly) store.save = async (entry) => { state.entry = entry; state.saves += 1; };
  return { store, state };
}

/** A fake Vercel Sandbox that records every sandbox it creates. */
function fakeSandboxes(tarball: Buffer, options: { failSnapshotRestore?: boolean; buildExitOnRestore?: number } = {}) {
  const sandboxes: { options: SandboxCreateOptions; scripts: string[]; written: string[]; stopped: boolean; snapshotted: boolean }[] = [];
  let nextSnapshot = 1;
  const factory: SandboxFactory = async (createOptions) => {
    if (createOptions.source?.type === "snapshot" && options.failSnapshotRestore) throw new Error("snapshot expired");
    const record = { options: createOptions, scripts: [] as string[], written: [] as string[], stopped: false, snapshotted: false };
    sandboxes.push(record);
    const restored = createOptions.source?.type === "snapshot";
    return {
      async runCommand({ args }) {
        const script = args?.[1] ?? "";
        record.scripts.push(script);
        const exitCode = /run build/.test(script) && restored ? options.buildExitOnRestore ?? 0 : 0;
        return { exitCode, output: async () => (/tar -cf/.test(script) ? "DEPLO_OUTPUT=dist\n" : "ok") };
      },
      async readFileToBuffer() { return tarball; },
      async writeFiles(files) { record.written.push(...files.map((file) => file.path)); },
      async snapshot() { record.snapshotted = true; return { snapshotId: "snap_" + nextSnapshot++ }; },
      async stop() { record.stopped = true; },
    };
  };
  return { factory, sandboxes };
}

const KEY = "a".repeat(64);

test("cache keys follow dependencies and lockfiles, not scripts or source", async () => {
  const base = { "package.json": JSON.stringify({ name: "a", version: "1.0.0", scripts: { build: "vite build" }, dependencies: { react: "^19.0.0" } }), "package-lock.json": "{\"lockfileVersion\":3}" };
  const a = await project(base);
  const b = await project({ ...base, "package.json": JSON.stringify({ dependencies: { react: "^19.0.0" }, version: "2.0.0", name: "a", scripts: { build: "vite build --mode x" } }), "src/main.ts": "changed" });
  const c = await project({ ...base, "package-lock.json": "{\"lockfileVersion\":3,\"x\":1}" });
  const d = await project({ ...base, "package.json": JSON.stringify({ dependencies: { react: "^19.1.0" } }) });
  try {
    const keyA = await dependencyCacheKey(a, "npm");
    assert.match(keyA ?? "", /^[a-f0-9]{64}$/);
    assert.equal(await dependencyCacheKey(b, "npm"), keyA, "scripts, version and source files do not matter");
    assert.notEqual(await dependencyCacheKey(c, "npm"), keyA, "lockfile changes invalidate");
    assert.notEqual(await dependencyCacheKey(d, "npm"), keyA, "dependency changes invalidate");
    assert.notEqual(await dependencyCacheKey(a, "pnpm"), keyA, "package manager matters");
    assert.notEqual(await dependencyCacheKey(a, "npm", ["SHARP_IGNORE_GLOBAL_LIBVIPS"]), keyA, "build variable names matter");
  } finally { for (const dir of [a, b, c, d]) await rm(dir, { recursive: true, force: true }); }
});

test("monorepos and unreadable manifests are not cached", async () => {
  const workspaces = await project({ "package.json": JSON.stringify({ workspaces: ["packages/*"] }) });
  const pnpm = await project({ "package.json": "{}", "pnpm-workspace.yaml": "packages: ['*']" });
  const broken = await project({ "package.json": "{not json" });
  try {
    assert.equal(await dependencyCacheKey(workspaces, "npm"), null);
    assert.equal(await dependencyCacheKey(pnpm, "pnpm"), null);
    assert.equal(await dependencyCacheKey(broken, "npm"), null);
  } finally { for (const dir of [workspaces, pnpm, broken]) await rm(dir, { recursive: true, force: true }); }
});

test("a first build installs normally, then saves a node_modules-only snapshot", async () => {
  const src = await project({ "package.json": "{}", "index.html": "x" });
  const fake = fakeSandboxes(await outputTar());
  const { store, state } = memoryStore();
  const dest = await tempDir("deplo-cache-out-");
  try {
    const result = await buildInSandbox({
      repositoryUrl: "https://github.com/o/r.git", revision: "main", accessToken: "ghs_secret", decision: viteDecision,
      hasNpmLock: false, destination: dest, factory: fake.factory, cache: { key: KEY, sourceRoot: src, store },
    });
    assert.equal(result.cache, "saved");
    assert.deepEqual(state.entry, { key: KEY, snapshotId: "snap_1" });
    const [box] = fake.sandboxes;
    assert.equal(box.options.source?.type, "git");
    assert.match(box.scripts[0], /npm install/);
    const prepare = box.scripts.find((script) => script.includes("! -name node_modules"));
    assert.ok(prepare, "everything except node_modules is removed before the snapshot");
    assert.match(prepare, /rm -rf node_modules\/\.cache/);
    assert.equal(box.snapshotted, true);
    assert.equal(box.stopped, false, "snapshot() already stops the sandbox");
  } finally { for (const dir of [src, dest]) await rm(dir, { recursive: true, force: true }); }
});

test("a matching cache starts from the snapshot, copies source in and skips the install", async () => {
  const src = await project({ "package.json": "{}", "index.html": "x", "build/config.js": "kept for checkouts", "node_modules/x/i.js": "local" });
  const fake = fakeSandboxes(await outputTar());
  const { store, state } = memoryStore({ key: KEY, snapshotId: "snap_old" });
  const dest = await tempDir("deplo-cache-out-");
  try {
    const result = await buildInSandbox({
      repositoryUrl: "https://github.com/o/r.git", revision: "main", accessToken: "ghs_secret", decision: viteDecision,
      hasNpmLock: false, destination: dest, factory: fake.factory, cache: { key: KEY, sourceRoot: src, store },
    });
    assert.equal(result.cache, "hit");
    const [box] = fake.sandboxes;
    assert.deepEqual(box.options.source, { type: "snapshot", snapshotId: "snap_old" });
    assert.equal(JSON.stringify(box.options).includes("ghs_secret"), false, "no clone, so the token never enters the sandbox");
    assert.match(box.scripts[0], /! -name node_modules/, "old source is cleared first");
    assert.deepEqual(box.written.sort(), ["build/config.js", "index.html", "package.json"]);
    assert.match(box.scripts[1], /reusing cached node_modules/);
    assert.equal(state.saves, 0, "an unchanged cache is not saved again");
    assert.equal(box.stopped, true);
    assert.match(result.log, /Restored the dependency cache/);
  } finally { for (const dir of [src, dest]) await rm(dir, { recursive: true, force: true }); }
});

test("changed dependencies or an expired snapshot fall back to a fresh install", async () => {
  const src = await project({ "package.json": "{}", "index.html": "x" });
  try {
    const stale = fakeSandboxes(await outputTar());
    const staleStore = memoryStore({ key: "b".repeat(64), snapshotId: "snap_old" });
    const result = await buildInSandbox({
      repositoryUrl: "https://github.com/o/r.git", revision: "main", accessToken: null, decision: viteDecision,
      hasNpmLock: false, destination: await tempDir("deplo-cache-out-"), factory: stale.factory, cache: { key: KEY, sourceRoot: src, store: staleStore.store },
    });
    assert.equal(stale.sandboxes[0].options.source?.type, "git");
    assert.equal(result.cache, "saved");
    assert.equal(staleStore.state.entry?.key, KEY);

    const expired = fakeSandboxes(await outputTar(), { failSnapshotRestore: true });
    const expiredResult = await buildInSandbox({
      repositoryUrl: "https://github.com/o/r.git", revision: "main", accessToken: null, decision: viteDecision,
      hasNpmLock: false, destination: await tempDir("deplo-cache-out-"), factory: expired.factory, cache: { key: KEY, sourceRoot: src, store: memoryStore({ key: KEY, snapshotId: "snap_gone" }).store },
    });
    assert.equal(expired.sandboxes[0].options.source?.type, "git");
    assert.match(expiredResult.log, /expired; installing from scratch/);
  } finally { await rm(src, { recursive: true, force: true }); }
});

test("a build that fails on the cache is retried once from a clean install", async () => {
  const src = await project({ "package.json": "{}", "index.html": "x" });
  const fake = fakeSandboxes(await outputTar(), { buildExitOnRestore: 1 });
  const { store, state } = memoryStore({ key: KEY, snapshotId: "snap_bad" });
  try {
    const result = await buildInSandbox({
      repositoryUrl: "https://github.com/o/r.git", revision: "main", accessToken: null, decision: viteDecision,
      hasNpmLock: false, destination: await tempDir("deplo-cache-out-"), factory: fake.factory, cache: { key: KEY, sourceRoot: src, store },
    });
    assert.deepEqual(fake.sandboxes.map((box) => box.options.source?.type), ["snapshot", "git"]);
    assert.equal(fake.sandboxes[0].stopped, true);
    assert.equal(result.cache, "saved");
    assert.equal(state.entry?.snapshotId, "snap_1", "the clean build replaces the bad cache");
    assert.match(result.log, /retried from a clean install/);
  } finally { await rm(src, { recursive: true, force: true }); }
});

test("read-only caches (pull request previews) are used but never saved", async () => {
  const src = await project({ "package.json": "{}", "index.html": "x" });
  const fake = fakeSandboxes(await outputTar());
  const { store, state } = memoryStore(null, true);
  try {
    const result = await buildInSandbox({
      repositoryUrl: "https://github.com/o/r.git", revision: "main", accessToken: null, decision: viteDecision,
      hasNpmLock: false, destination: await tempDir("deplo-cache-out-"), factory: fake.factory, cache: { key: KEY, sourceRoot: src, store },
    });
    assert.equal(result.cache, "miss");
    assert.equal(state.entry, null);
    assert.equal(fake.sandboxes[0].snapshotted, false);
    assert.equal(fake.sandboxes[0].stopped, true);
  } finally { await rm(src, { recursive: true, force: true }); }
});

test("install failures without a cache are not retried", async () => {
  const factory: SandboxFactory = async () => ({
    async runCommand() { return { exitCode: 1, output: async () => "npm ERR!" }; },
    async readFileToBuffer() { return null; },
    async stop() { return undefined; },
  });
  let creations = 0;
  await assert.rejects(buildInSandbox({
    repositoryUrl: "https://github.com/o/r.git", revision: "main", accessToken: null, decision: viteDecision,
    hasNpmLock: false, destination: await tempDir("deplo-cache-out-"), factory: async (options) => { creations += 1; return factory(options); },
  }), (error: unknown) => error instanceof SandboxBuildError && error.code === "install_failed");
  assert.equal(creations, 1);
});

test("the Supabase store reads, validates and upserts one row per project", async () => {
  const projectId = "6f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f";
  const env = { SUPABASE_URL: "https://db.example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key" };
  const requests: { url: string; method: string; body?: unknown }[] = [];
  let rows: unknown = [{ cache_key: KEY, snapshot_id: "snap_123" }];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(rows), { status: 200 });
  }) as typeof fetch;

  const store = supabaseBuildCache(42, projectId, {}, env, fetcher);
  assert.ok(store?.save);
  assert.deepEqual(await store.load(), { key: KEY, snapshotId: "snap_123" });
  const read = new URL(requests[0].url);
  assert.equal(read.searchParams.get("project_id"), "eq." + projectId);
  assert.equal(read.searchParams.get("owner_github_id"), "eq.42");

  await store.save({ key: KEY, snapshotId: "snap_456" });
  assert.equal(requests[1].method, "POST");
  assert.match(requests[1].url, /on_conflict=project_id/);
  assert.deepEqual(requests[1].body, { project_id: projectId, owner_github_id: 42, cache_key: KEY, snapshot_id: "snap_456", updated_at: (requests[1].body as { updated_at: string }).updated_at });

  rows = [{ cache_key: KEY, snapshot_id: "snap; rm -rf /" }];
  assert.equal(await store.load(), null, "malformed snapshot IDs are ignored");
  await store.save({ key: "not-a-hash", snapshotId: "snap_1" });
  assert.equal(requests.length, 3, "invalid entries are never written");

  assert.equal(supabaseBuildCache(42, projectId, { readOnly: true }, env, fetcher)?.save, undefined);
  assert.equal(supabaseBuildCache(42, projectId, {}, {}, fetcher), null, "no storage configured");
  assert.equal(supabaseBuildCache(42, projectId, {}, { ...env, DEPLO_DISABLE_BUILD_CACHE: "1" }, fetcher), null);
  assert.equal(supabaseBuildCache(42, "not-a-uuid", {}, env, fetcher), null);

  const failing = supabaseBuildCache(42, projectId, {}, env, (async () => new Response("relation does not exist", { status: 404 })) as typeof fetch);
  assert.equal(await failing?.load(), null, "an unmigrated database just means no cache");
});
