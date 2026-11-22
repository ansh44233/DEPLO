import type { IsolatedBuildLimits } from "../../../lib/deploy/build-runner-contract";

export type FirecrackerHostConfig = Readonly<{
  firecrackerBinary: string;
  jailerBinary: string;
  kernelImage: string;
  initrdImage: string;
  jailerWorkDir: string;
  cgroupRoot: string;
  tapDevice: string;
}>;

export type FirecrackerVmPlan = Readonly<{
  jobId: string;
  vcpuCount: number;
  memoryMiB: number;
  diskMiB: number;
  timeoutSeconds: number;
  maxProcesses: number;
  maxOutputFiles: number;
  maxOutputBytes: number;
  network: "deny";
  host: FirecrackerHostConfig;
}>;

const ABSOLUTE_PATH = /^\//;
const SAFE_INTERFACE = /^[a-zA-Z0-9_.-]{1,15}$/;

/**
 * Creates a data-only VM plan from trusted operator configuration and validated
 * job limits. This module never starts Firecracker, creates devices, or executes
 * repository code. A future supervisor must enforce every field at the OS level.
 */
export function createFirecrackerVmPlan(input: {
  jobId: string;
  limits: IsolatedBuildLimits;
  maxProcesses: number;
  host: FirecrackerHostConfig;
}): FirecrackerVmPlan {
  if (!/^[0-9a-f-]{36}$/i.test(input.jobId)) throw new Error("invalid_job_id");
  const paths = Object.values(input.host).filter((value, index) => index < 6);
  if (paths.some(value => typeof value !== "string" || !ABSOLUTE_PATH.test(value) || value.includes("\0"))) {
    throw new Error("invalid_host_path");
  }
  if (new Set(paths).size !== paths.length) throw new Error("duplicate_host_path");
  if (!SAFE_INTERFACE.test(input.host.tapDevice)) throw new Error("invalid_tap_device");

  const { timeoutSeconds, memoryMiB, cpuMillicores, diskMiB, maxOutputFiles, maxOutputBytes, networkPolicy } = input.limits;
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 600) throw new Error("invalid_timeout");
  if (!Number.isInteger(memoryMiB) || memoryMiB < 256 || memoryMiB > 2048) throw new Error("invalid_memory_limit");
  if (!Number.isInteger(cpuMillicores) || cpuMillicores < 100 || cpuMillicores > 2000) throw new Error("invalid_cpu_limit");
  if (!Number.isInteger(diskMiB) || diskMiB < 256 || diskMiB > 4096) throw new Error("invalid_disk_limit");
  if (!Number.isInteger(maxOutputFiles) || maxOutputFiles < 1 || maxOutputFiles > 5000) throw new Error("invalid_output_file_limit");
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > 100 * 1024 * 1024) throw new Error("invalid_output_byte_limit");
  if (networkPolicy !== "deny-by-default") throw new Error("network_must_be_denied");
  if (!Number.isInteger(input.maxProcesses) || input.maxProcesses < 1 || input.maxProcesses > 128) throw new Error("invalid_process_limit");

  return Object.freeze({
    jobId: input.jobId,
    vcpuCount: Math.max(1, Math.min(2, Math.ceil(cpuMillicores / 1000))),
    memoryMiB,
    diskMiB,
    timeoutSeconds,
    maxProcesses: input.maxProcesses,
    maxOutputFiles,
    maxOutputBytes,
    network: "deny",
    host: Object.freeze({ ...input.host }),
  });
}
