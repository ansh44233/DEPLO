import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectSandboxHost } from "../../services/build-runner/src/host-preflight";

test("reports the Firecracker jailer prerequisite independently", async () => {
  const root = await mkdtemp(join(tmpdir(), "deplo-preflight-"));
  try {
    const jailer = join(root, "jailer");
    const kernel = join(root, "kernel");
    const initrd = join(root, "initrd");
    const controllers = join(root, "cgroup.controllers");
    await writeFile(jailer, "#!/bin/sh\n", { mode: 0o700 });
    await chmod(jailer, 0o700);
    await writeFile(kernel, "kernel");
    await writeFile(initrd, "initrd");
    await writeFile(controllers, "cpu memory pids");

    const result = await inspectSandboxHost({
      platform: "linux",
      kvmDevicePath: join(root, "missing-kvm"),
      firecrackerBinaryPath: join(root, "missing-firecracker"),
      jailerBinaryPath: jailer,
      kernelImagePath: kernel,
      initrdPath: initrd,
      cgroupControllersPath: controllers,
    });

    assert.equal(result.jailerBinaryAvailable, true);
    assert.equal(result.firecrackerBinaryAvailable, false);
    assert.equal(result.kernelImageAvailable, true);
    assert.equal(result.initrdAvailable, true);
    assert.equal(result.cgroupV2RequiredControllersAvailable, true);
    assert.ok(result.blockers.includes("firecracker_binary_unavailable"));
    assert.ok(result.blockers.includes("kvm_unavailable"));
    assert.ok(result.blockers.includes("firecracker_execution_backend_not_implemented"));
    assert.equal(result.buildsEnabled, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("requires the jailer executable on Linux", async () => {
  const result = await inspectSandboxHost({
    platform: "linux",
    kvmDevicePath: "/missing/kvm",
    firecrackerBinaryPath: "/missing/firecracker",
    jailerBinaryPath: "/missing/jailer",
    kernelImagePath: "/missing/kernel",
    initrdPath: "/missing/initrd",
    cgroupControllersPath: "/missing/controllers",
  });
  assert.equal(result.jailerBinaryAvailable, false);
  assert.ok(result.blockers.includes("firecracker_jailer_unavailable"));
});

test("does not inspect Linux-only prerequisites on other platforms", async () => {
  const result = await inspectSandboxHost({ platform: "darwin" });
  assert.equal(result.linuxHost, false);
  assert.equal(result.jailerBinaryAvailable, false);
  assert.ok(result.blockers.includes("linux_host_required"));
  assert.ok(result.blockers.includes("firecracker_jailer_unavailable"));
  assert.equal(result.buildsEnabled, false);
});
