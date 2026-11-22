import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ISOLATED_BUILD_LIMITS } from "../../lib/deploy/build-runner-contract";
import { createFirecrackerVmPlan, type FirecrackerHostConfig } from "../../services/build-runner/src/firecracker-contract";

const host: FirecrackerHostConfig = {
  firecrackerBinary: "/usr/bin/firecracker",
  jailerBinary: "/usr/bin/jailer",
  kernelImage: "/var/lib/deplo/kernel",
  initrdImage: "/var/lib/deplo/initrd",
  jailerWorkDir: "/var/lib/deplo/jailer",
  cgroupRoot: "/sys/fs/cgroup/deplo",
  tapDevice: "deplo0",
};

test("creates a data-only plan with bounded defaults and deny network policy", () => {
  const plan = createFirecrackerVmPlan({
    jobId: "123e4567-e89b-12d3-a456-426614174000",
    limits: { ...DEFAULT_ISOLATED_BUILD_LIMITS },
    maxProcesses: 128,
    host,
  });
  assert.equal(plan.vcpuCount, 2);
  assert.equal(plan.memoryMiB, 2048);
  assert.equal(plan.network, "deny");
  assert.equal(plan.maxProcesses, 128);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.host), true);
});

test("rejects invalid job IDs and host paths", () => {
  assert.throws(() => createFirecrackerVmPlan({
    jobId: "not-a-uuid", limits: { ...DEFAULT_ISOLATED_BUILD_LIMITS }, maxProcesses: 128, host,
  }), /invalid_job_id/);
  assert.throws(() => createFirecrackerVmPlan({
    jobId: "123e4567-e89b-12d3-a456-426614174000",
    limits: { ...DEFAULT_ISOLATED_BUILD_LIMITS }, maxProcesses: 128,
    host: { ...host, kernelImage: "relative/kernel" },
  }), /invalid_host_path/);
});

test("rejects duplicate host paths and unsafe tap interface names", () => {
  assert.throws(() => createFirecrackerVmPlan({
    jobId: "123e4567-e89b-12d3-a456-426614174000",
    limits: { ...DEFAULT_ISOLATED_BUILD_LIMITS }, maxProcesses: 128,
    host: { ...host, initrdImage: host.kernelImage },
  }), /duplicate_host_path/);
  assert.throws(() => createFirecrackerVmPlan({
    jobId: "123e4567-e89b-12d3-a456-426614174000",
    limits: { ...DEFAULT_ISOLATED_BUILD_LIMITS }, maxProcesses: 128,
    host: { ...host, tapDevice: "unsafe interface" },
  }), /invalid_tap_device/);
});

test("rejects excessive resources and any network policy other than deny-by-default", () => {
  assert.throws(() => createFirecrackerVmPlan({
    jobId: "123e4567-e89b-12d3-a456-426614174000",
    limits: { ...DEFAULT_ISOLATED_BUILD_LIMITS, memoryMiB: 4096 }, maxProcesses: 128, host,
  }), /invalid_memory_limit/);
  assert.throws(() => createFirecrackerVmPlan({
    jobId: "123e4567-e89b-12d3-a456-426614174000",
    limits: { ...DEFAULT_ISOLATED_BUILD_LIMITS, networkPolicy: "allow" as "deny-by-default" },
    maxProcesses: 128, host,
  }), /network_must_be_denied/);
  assert.throws(() => createFirecrackerVmPlan({
    jobId: "123e4567-e89b-12d3-a456-426614174000",
    limits: { ...DEFAULT_ISOLATED_BUILD_LIMITS }, maxProcesses: 129, host,
  }), /invalid_process_limit/);
});
