import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspaceManager } from "../../services/build-runner/src/workspace";
import { cleanupStaleWorkspaces } from "../../services/build-runner/src/workspace-janitor";
import { createWorkspaceLease, inspectWorkspaceLease } from "../../services/build-runner/src/workspace-lease";

const HOUR = 60 * 60 * 1000;

test("workspace lease heartbeat refreshes an active lease atomically", async () => {
  const parent = await mkdtemp(join(tmpdir(), "deplo-lease-heartbeat-"));
  try {
    const root = join(parent, "job-heartbeat");
    await mkdir(root);
    const lease = await createWorkspaceLease(root, 10 * HOUR);
    const before = await inspectWorkspaceLease(root, 10 * HOUR + 2 * HOUR, 24 * HOUR);
    assert.equal(before.state, "active");
    await lease.heartbeat(12 * HOUR);
    const after = await inspectWorkspaceLease(root, 12 * HOUR + HOUR, 24 * HOUR);
    assert.equal(after.state, "active");
    if (after.state === "active") assert.equal(after.lease.leaseId, lease.leaseId);
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test("workspace manager creates a lease and exposes heartbeat", async () => {
  const parent = await mkdtemp(join(tmpdir(), "deplo-manager-lease-"));
  try {
    const manager = await createWorkspaceManager(join(parent, "workspaces"));
    const workspace = await manager.create();
    assert.equal((await readdir(workspace.root)).includes(".deplo-workspace-lease.json"), true);
    await workspace.heartbeat();
    await workspace.cleanup();
    assert.equal(manager.activeCount(), 0);
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test("janitor preserves old workspace directories with a fresh lease heartbeat", async () => {
  const parent = await mkdtemp(join(tmpdir(), "deplo-janitor-active-"));
  const root = join(parent, "workspaces");
  const now = 50 * HOUR;
  try {
    await mkdir(root);
    const workspaceRoot = join(root, "job-active");
    await mkdir(workspaceRoot);
    const lease = await createWorkspaceLease(workspaceRoot, now - 2 * HOUR);
    await utimes(workspaceRoot, new Date(now - 40 * HOUR), new Date(now - 40 * HOUR));
    await lease.heartbeat(now - HOUR);
    const result = await cleanupStaleWorkspaces(root, { now, retentionMs: 24 * HOUR });
    assert.equal(result.workspacesRemoved, 0);
    assert.equal(result.skipped, 1);
    assert.equal((await readdir(root)).includes("job-active"), true);
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test("janitor removes workspaces only after their lease heartbeat expires", async () => {
  const parent = await mkdtemp(join(tmpdir(), "deplo-janitor-expired-"));
  const root = join(parent, "workspaces");
  const now = 50 * HOUR;
  try {
    await mkdir(root);
    const workspaceRoot = join(root, "job-expired");
    await mkdir(workspaceRoot);
    await createWorkspaceLease(workspaceRoot, now - 30 * HOUR);
    const result = await cleanupStaleWorkspaces(root, { now, retentionMs: 24 * HOUR });
    assert.equal(result.workspacesRemoved, 1);
    assert.equal((await readdir(root)).length, 0);
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test("janitor fails closed and skips malformed or symlinked lease markers", async () => {
  const parent = await mkdtemp(join(tmpdir(), "deplo-janitor-invalid-"));
  const root = join(parent, "workspaces");
  const now = 50 * HOUR;
  try {
    await mkdir(root);
    const malformed = join(root, "job-malformed");
    await mkdir(malformed);
    await writeFile(join(malformed, ".deplo-workspace-lease.json"), "{bad", { mode: 0o600 });
    const result = await cleanupStaleWorkspaces(root, { now, retentionMs: 24 * HOUR });
    assert.equal(result.workspacesRemoved, 0);
    assert.equal(result.skipped, 1);
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test("invalid lease timestamps are rejected", async () => {
  const parent = await mkdtemp(join(tmpdir(), "deplo-lease-invalid-"));
  try {
    const root = join(parent, "job-invalid");
    await mkdir(root);
    await writeFile(join(root, ".deplo-workspace-lease.json"), JSON.stringify({
      version: 1, workspaceId: "job-invalid", leaseId: "00000000-0000-4000-8000-000000000000",
      createdAt: 10, heartbeatAt: Number.POSITIVE_INFINITY,
    }));
    assert.deepEqual(await inspectWorkspaceLease(root, 20, HOUR), { state: "invalid" });
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test("concurrent heartbeats are serialized and cannot move lease time backwards", async () => {
  const parent = await mkdtemp(join(tmpdir(), "deplo-lease-order-"));
  try {
    const root = join(parent, "job-order");
    await mkdir(root);
    const lease = await createWorkspaceLease(root, 10 * HOUR);
    await Promise.all([lease.heartbeat(12 * HOUR), lease.heartbeat(13 * HOUR)]);
    const state = await inspectWorkspaceLease(root, 13 * HOUR, 24 * HOUR);
    assert.equal(state.state, "active");
    if (state.state === "active") assert.equal(state.lease.heartbeatAt, 13 * HOUR);
    await assert.rejects(lease.heartbeat(11 * HOUR), /workspace_heartbeat_out_of_order/);
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test("a stale lease handle cannot refresh a marker owned by another lease", async () => {
  const parent = await mkdtemp(join(tmpdir(), "deplo-lease-owner-"));
  try {
    const root = join(parent, "job-owner");
    await mkdir(root);
    const lease = await createWorkspaceLease(root, 10 * HOUR);
    await writeFile(join(root, ".deplo-workspace-lease.json"), JSON.stringify({
      version: 1, leaseId: "00000000-0000-4000-8000-000000000000",
      workspaceId: "job-owner", createdAt: 10 * HOUR, heartbeatAt: 11 * HOUR,
    }));
    await assert.rejects(lease.heartbeat(12 * HOUR), /workspace_lease_ownership_lost/);
  } finally { await rm(parent, { recursive: true, force: true }); }
});
