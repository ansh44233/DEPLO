import { stat, readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

export type SandboxHostPreflightOptions = Readonly<{
  platform?: string; kvmDevicePath?: string; firecrackerBinaryPath?: string;
  kernelImagePath?: string; initrdPath?: string; cgroupControllersPath?: string;
}>;

async function inspectPath(path: string | undefined, kind: "file" | "executable" | "device"): Promise<boolean> {
  if (!path || !isAbsolute(path)) return false;
  try {
    const info = await stat(path);
    if (kind === "device") return info.isCharacterDevice();
    if (!info.isFile()) return false;
    return kind !== "executable" || (info.mode & 0o111) !== 0;
  } catch { return false; }
}

/** Inventory only: these host checks do not start Firecracker or enforce isolation. */
export async function inspectSandboxHost(options: SandboxHostPreflightOptions = {}) {
  const platform = options.platform ?? process.platform;
  const linux = platform === "linux";
  const [kvmDeviceAvailable, firecrackerBinaryAvailable, kernelImageAvailable, initrdAvailable, controllers] = linux
    ? await Promise.all([
        inspectPath(options.kvmDevicePath ?? process.env.DEPLO_FIRECRACKER_KVM_PATH ?? "/dev/kvm", "device"),
        inspectPath(options.firecrackerBinaryPath ?? process.env.DEPLO_FIRECRACKER_BIN, "executable"),
        inspectPath(options.kernelImagePath ?? process.env.DEPLO_FIRECRACKER_KERNEL, "file"),
        inspectPath(options.initrdPath ?? process.env.DEPLO_FIRECRACKER_INITRD, "file"),
        (async () => {
          const path = options.cgroupControllersPath ?? "/sys/fs/cgroup/cgroup.controllers";
          if (!isAbsolute(path)) return [];
          try { return (await readFile(path, "utf8")).trim().split(/\\s+/).filter(Boolean); }
          catch { return []; }
        })(),
      ])
    : [false, false, false, false, [] as string[]];
  const cgroupV2RequiredControllersAvailable = ["cpu", "memory", "pids"].every(name => controllers.includes(name));
  const blockers: string[] = [];
  if (!linux) blockers.push("linux_host_required");
  if (!kvmDeviceAvailable) blockers.push("kvm_unavailable");
  if (!firecrackerBinaryAvailable) blockers.push("firecracker_binary_unavailable");
  if (!kernelImageAvailable) blockers.push("kernel_image_unavailable");
  if (!initrdAvailable) blockers.push("initrd_unavailable");
  if (!cgroupV2RequiredControllersAvailable) blockers.push("cgroup_v2_controllers_unavailable");
  blockers.push("firecracker_execution_backend_not_implemented");
  return { linuxHost: linux, kvmDeviceAvailable, firecrackerBinaryAvailable, kernelImageAvailable,
    initrdAvailable, cgroupV2RequiredControllersAvailable, backendImplemented: false,
    resourceLimitsEnforced: false, networkEgressDenied: false, buildsEnabled: false, blockers };
}
