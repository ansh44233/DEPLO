/**
 * Data-only lifecycle contract for a future Firecracker supervisor.
 * This module does not create VMs, execute commands, or enforce isolation.
 */
export type SupervisorState =
  | "queued"
  | "preparing"
  | "starting"
  | "running"
  | "stopping"
  | "succeeded"
  | "failed"
  | "cancelled";

export type SupervisorEvent =
  | "prepare"
  | "start"
  | "started"
  | "stop"
  | "succeed"
  | "fail"
  | "cancel";

export type SupervisorEvidence = Readonly<{
  hostPreflightPassed?: boolean;
  vmIsolationVerified?: boolean;
  resourceLimitsVerified?: boolean;
  networkIsolationVerified?: boolean;
  vmStopped?: boolean;
  artifactValidated?: boolean;
  cleanupComplete?: boolean;
}>;

const TERMINAL = new Set<SupervisorState>(["succeeded", "failed", "cancelled"]);

function requireEvidence(condition: boolean, code: string): void {
  if (!condition) throw new Error(code);
}

/**
 * Pure state transition validator. Evidence is supplied by a future trusted
 * supervisor; callers must not treat this function as proof that controls ran.
 */
export function transitionSupervisorState(
  current: SupervisorState,
  event: SupervisorEvent,
  evidence: SupervisorEvidence = {},
): SupervisorState {
  if (TERMINAL.has(current)) throw new Error("supervisor_state_terminal");

  if (current === "queued" && event === "prepare") return "preparing";
  if (current === "queued" && event === "cancel") return "cancelled";

  if (current === "preparing" && event === "start") {
    requireEvidence(evidence.hostPreflightPassed === true, "host_preflight_required");
    return "starting";
  }

  if (current === "starting" && event === "started") {
    requireEvidence(evidence.vmIsolationVerified === true, "vm_isolation_not_verified");
    requireEvidence(evidence.resourceLimitsVerified === true, "resource_limits_not_verified");
    requireEvidence(evidence.networkIsolationVerified === true, "network_isolation_not_verified");
    return "running";
  }

  if ((current === "preparing" || current === "starting" || current === "running") && event === "stop") {
    return "stopping";
  }

  if (current === "stopping" && event === "succeed") {
    requireEvidence(evidence.vmStopped === true, "vm_must_be_stopped");
    requireEvidence(evidence.artifactValidated === true, "artifact_must_be_validated");
    requireEvidence(evidence.cleanupComplete === true, "cleanup_must_complete");
    return "succeeded";
  }

  if (
    (current === "preparing" || current === "starting" || current === "running" || current === "stopping") &&
    event === "fail"
  ) {
    requireEvidence(evidence.vmStopped === true, "vm_must_be_stopped");
    requireEvidence(evidence.cleanupComplete === true, "cleanup_must_complete");
    return "failed";
  }

  if (current === "stopping" && event === "cancel") {
    requireEvidence(evidence.vmStopped === true, "vm_must_be_stopped");
    requireEvidence(evidence.cleanupComplete === true, "cleanup_must_complete");
    return "cancelled";
  }

  throw new Error("invalid_supervisor_transition");
}
