import type { SupervisorRecoveryAction } from "./supervisor-recovery";

export type SupervisorRecoveryBackendCapabilities = Readonly<{
  hostInventory: boolean;
  ownershipVerification: boolean;
  vmControl: boolean;
  workspaceCleanup: boolean;
  jobQueueControl: boolean;
}>;

export type SupervisorRecoveryWorkerDecision = Readonly<{
  ready: false;
  executionEnabled: false;
  claimedRecordMayBeAcknowledged: false;
  executableActions: readonly [];
  blockers: readonly string[];
}>;

const REQUIRED_CAPABILITIES: readonly (keyof SupervisorRecoveryBackendCapabilities)[] = [
  "hostInventory",
  "ownershipVerification",
  "vmControl",
  "workspaceCleanup",
  "jobQueueControl",
];

const BLOCKER_CODES: Readonly<Record<keyof SupervisorRecoveryBackendCapabilities, string>> = {
  hostInventory: "host_inventory_unavailable",
  ownershipVerification: "resource_ownership_unverified",
  vmControl: "vm_control_unavailable",
  workspaceCleanup: "workspace_cleanup_unavailable",
  jobQueueControl: "job_queue_control_unavailable",
};

const ALLOWED_ACTIONS = new Set<SupervisorRecoveryAction>([
  "inspect_owned_resources",
  "stop_owned_vm_if_present",
  "remove_owned_workspace_if_present",
  "requeue_job",
  "record_recovery_failure",
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isValidCapabilities(value: unknown): value is SupervisorRecoveryBackendCapabilities {
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length === REQUIRED_CAPABILITIES.length
    && REQUIRED_CAPABILITIES.every((key) => keys.includes(key) && typeof value[key] === "boolean");
}

function isValidActions(value: unknown): value is readonly SupervisorRecoveryAction[] {
  return Array.isArray(value) && value.every((action) => ALLOWED_ACTIONS.has(action));
}

function decision(blockers: readonly string[]): SupervisorRecoveryWorkerDecision {
  return Object.freeze({
    ready: false,
    executionEnabled: false,
    claimedRecordMayBeAcknowledged: false,
    executableActions: Object.freeze([]) as readonly [],
    blockers: Object.freeze([...new Set(blockers)]),
  });
}

/**
 * Fail-closed gate for the future recovery executor.
 *
 * Runtime inputs are treated as untrusted despite the TypeScript contract.
 * Capability flags are diagnostic inputs, not proof that an operation is safe.
 * This gate never authorizes an action or a ledger acknowledgement.
 */
export function evaluateSupervisorRecoveryWorker(
  capabilities: unknown,
  plannedActions: unknown,
): SupervisorRecoveryWorkerDecision {
  try {
    if (!isValidCapabilities(capabilities) || !isValidActions(plannedActions)) {
      return decision(["invalid_recovery_worker_input", "recovery_executor_not_implemented"]);
    }

    const blockers = REQUIRED_CAPABILITIES
      .filter((capability) => capabilities[capability] !== true)
      .map((capability) => BLOCKER_CODES[capability]);

    // Passing the checklist does not prove isolation, ownership, or implementation.
    blockers.push("recovery_executor_not_implemented");
    return decision(blockers);
  } catch {
    // Malformed objects (including throwing accessors/proxies) must not open the gate.
    return decision(["invalid_recovery_worker_input", "recovery_executor_not_implemented"]);
  }
}
