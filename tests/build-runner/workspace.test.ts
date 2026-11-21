import test from "node:test";
import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspaceManager, DEFAULT_BUILD_RESOURCE_POLICY } from "../../services/build-runner/src/workspace";

test("resource policy defaults are bounded and deny network access", () => {
  assert.deepEqual(DEFAULT_BUILD_RESOURCE_POLICY, {
    timeoutMs: 600_000,
    memoryMb: 2048,
    cpuCores: 2,
    diskMb: 4096,
    maxProcesses: 128,
    maxOutputFiles: 5000,
    maxOutputBytes: 100 * 1024 * 1024,
    maxLogBytes: 2 * 1024 * 1024,
    network: "deny",
  });
  assert.equal(Object.isFrozen(DEFAULT_BUILD_RESOURCE_POLICY), true);
});

test("workspace manager creates private separated directories and removes them idempotently", async () => {
  const parent = await mkdtemp(join(tmpdir(), "deplo-workspace-test-"));
  const root = join(parent, "workspaces");
  try {
    const manager = await createWorkspaceManager(root);
    const workspace = await manager.create();
    assert.match(workspace.id, /^job-/);
    assert.deepEqual((await readdir(workspace.root)).sort(), ["output", "source", "work"]);
    for (const path of [root, workspace.root, workspace.sourceDir, workspace.outputDir, workspace.workDir]) {
      const info = await lstat(path);
      assert.equal(info.isDirectory(), true);
      if (process.platform !== "win32") assert.equal(info.mode & 0o777, 0o700);
    }
    await workspace.cleanup();
    await workspace.cleanup();
    await assert.rejects(lstat(workspace.root), { code: "ENOENT" });
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("workspace manager refuses a symlink workspace root", async () => {
  const parent = await mkdtemp(join(tmpdir(), "deplo-workspace-link-"));
  const actual = join(parent, "actual");
  const linked = join(parent, "linked");
  try {
    await import("node:fs/promises").then(fs => fs.mkdir(actual));
    await symlink(actual, linked, "dir");
    await assert.rejects(createWorkspaceManager(linked), /workspace_root_must_be_a_real_directory|workspace_root_must_not_resolve_through_symlinks/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("workspace manager rejects relative and filesystem-root paths", async () => {
  await assert.rejects(createWorkspaceManager("relative-workspaces"), /workspace_root_must_be_absolute_canonical_and_non_root/);
  await assert.rejects(createWorkspaceManager("/"), /workspace_root_must_be_absolute_canonical_and_non_root/);
});
