import { skipWithoutSymlinks } from "../helpers/platform";
import test from "node:test";
import assert from "node:assert/strict";
import { lstat, mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspaceManager, DEFAULT_BUILD_RESOURCE_POLICY } from "../../services/build-runner/src/workspace";

test("resource policy defaults are bounded and deny network access", () => {
  assert.deepEqual(DEFAULT_BUILD_RESOURCE_POLICY, {
    timeoutMs: 600_000, memoryMb: 2048, cpuCores: 2, diskMb: 4096,
    maxProcesses: 128, maxOutputFiles: 5000, maxOutputBytes: 100 * 1024 * 1024,
    maxLogBytes: 2 * 1024 * 1024, network: "deny",
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
    assert.deepEqual((await readdir(workspace.root)).sort(), [".deplo-workspace-lease.json", "output", "source", "work"]);
    for (const path of [root, workspace.root, workspace.sourceDir, workspace.outputDir, workspace.workDir]) {
      const info = await lstat(path);
      assert.equal(info.isDirectory(), true);
      if (process.platform !== "win32") assert.equal(info.mode & 0o777, 0o700);
    }
    await workspace.cleanup();
    await workspace.cleanup();
    await assert.rejects(lstat(workspace.root), { code: "ENOENT" });
    assert.equal(manager.activeCount(), 0);
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test("workspace manager refuses a symlink workspace root", { skip: skipWithoutSymlinks }, async () => {
  const parent = await mkdtemp(join(tmpdir(), "deplo-workspace-link-"));
  const actual = join(parent, "actual");
  const linked = join(parent, "linked");
  try {
    await import("node:fs/promises").then(fs => fs.mkdir(actual));
    await symlink(actual, linked, "dir");
    await assert.rejects(createWorkspaceManager(linked), /workspace_root_must_be_a_real_directory|workspace_root_must_not_resolve_through_symlinks/);
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test("workspace manager rejects relative and filesystem-root paths", async () => {
  await assert.rejects(createWorkspaceManager("relative-workspaces"), /workspace_root_must_be_absolute_canonical_and_non_root/);
  await assert.rejects(createWorkspaceManager("/"), /workspace_root_must_be_absolute_canonical_and_non_root/);
});

test("workspace manager enforces a process-local concurrency cap and releases capacity on cleanup", async () => {
  const parent = await mkdtemp(join(tmpdir(), "deplo-workspace-cap-"));
  try {
    const manager = await createWorkspaceManager(join(parent, "workspaces"), { maxActiveWorkspaces: 1 });
    const first = await manager.create();
    assert.equal(manager.activeCount(), 1);
    await assert.rejects(manager.create(), /workspace_capacity_exceeded/);
    await first.cleanup();
    const second = await manager.create();
    assert.equal(manager.activeCount(), 1);
    await second.cleanup();
    assert.equal(manager.activeCount(), 0);
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test("workspace manager rejects invalid concurrency caps", async () => {
  const parent = await mkdtemp(join(tmpdir(), "deplo-workspace-invalid-cap-"));
  try {
    await assert.rejects(createWorkspaceManager(join(parent, "a"), { maxActiveWorkspaces: 0 }), /invalid_max_active_workspaces/);
    await assert.rejects(createWorkspaceManager(join(parent, "b"), { maxActiveWorkspaces: 129 }), /invalid_max_active_workspaces/);
  } finally { await rm(parent, { recursive: true, force: true }); }
});
