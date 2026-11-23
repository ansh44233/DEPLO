import { skipWithoutSymlinks } from "../helpers/platform";
import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupStaleWorkspaces, DEFAULT_WORKSPACE_RETENTION_MS } from "../../services/build-runner/src/workspace-janitor";

test("janitor removes old job workspaces in a bounded batch and reports bytes", async () => {
  const parent = await mkdtemp(join(tmpdir(), "deplo-janitor-"));
  const root = join(parent, "workspaces");
  const old = join(root, "job-old123");
  const recent = join(root, "job-recent123");
  try {
    await mkdir(old, { recursive: true, mode: 0o700 });
    await mkdir(join(old, "work"));
    await writeFile(join(old, "work", "artifact.tmp"), "hello");
    await mkdir(recent);
    const stale = new Date(Date.now() - DEFAULT_WORKSPACE_RETENTION_MS - 1000);
    await utimes(old, stale, stale);
    const result = await cleanupStaleWorkspaces(root);
    assert.deepEqual(result, { workspacesRemoved: 1, bytesFreed: 5, skipped: 0 });
    assert.deepEqual(await readdir(root), ["job-recent123"]);
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test("janitor respects retention and batch limits", async () => {
  const parent = await mkdtemp(join(tmpdir(), "deplo-janitor-batch-"));
  const root = join(parent, "workspaces");
  try {
    await mkdir(root);
    const old = new Date(Date.now() - DEFAULT_WORKSPACE_RETENTION_MS - 1000);
    for (const name of ["job-one", "job-two", "job-three"]) {
      const path = join(root, name);
      await mkdir(path);
      await utimes(path, old, old);
    }
    const result = await cleanupStaleWorkspaces(root, { batchLimit: 2 });
    assert.equal(result.workspacesRemoved, 2);
    assert.equal((await readdir(root)).length, 1);
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test("janitor ignores unrelated files and symlink entries", { skip: skipWithoutSymlinks }, async () => {
  const parent = await mkdtemp(join(tmpdir(), "deplo-janitor-links-"));
  const root = join(parent, "workspaces");
  const target = join(parent, "target");
  try {
    await mkdir(root);
    await mkdir(target);
    await writeFile(join(target, "keep.txt"), "safe");
    await symlink(target, join(root, "job-link"), "dir");
    await writeFile(join(root, "notes.txt"), "keep");
    const result = await cleanupStaleWorkspaces(root);
    assert.equal(result.workspacesRemoved, 0);
    assert.equal(result.skipped, 1);
    assert.equal((await readdir(target)).includes("keep.txt"), true);
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test("janitor rejects unsafe roots and cleanup policies", async () => {
  await assert.rejects(cleanupStaleWorkspaces("relative"), /workspace_root_must_be_absolute_canonical_and_non_root/);
  await assert.rejects(cleanupStaleWorkspaces("/"), /workspace_root_must_be_absolute_canonical_and_non_root/);
  const parent = await mkdtemp(join(tmpdir(), "deplo-janitor-invalid-"));
  try {
    const root = join(parent, "workspaces");
    await mkdir(root);
    await assert.rejects(cleanupStaleWorkspaces(root, { retentionMs: 1000 }), /invalid_workspace_cleanup_policy/);
    await assert.rejects(cleanupStaleWorkspaces(root, { batchLimit: 101 }), /invalid_workspace_cleanup_policy/);
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test("janitor refuses a symlink root", { skip: skipWithoutSymlinks }, async () => {
  const parent = await mkdtemp(join(tmpdir(), "deplo-janitor-root-"));
  const real = join(parent, "real");
  const linked = join(parent, "linked");
  try {
    await mkdir(real);
    await symlink(real, linked, "dir");
    await assert.rejects(cleanupStaleWorkspaces(linked), /workspace_root_must_be_a_real_directory|workspace_root_must_not_resolve_through_symlinks/);
  } finally { await rm(parent, { recursive: true, force: true }); }
});
