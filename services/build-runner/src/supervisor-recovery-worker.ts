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

/**
 * Fail-closed gate for the future recovery executor.
 *
 * Capability flags are diagnostic inputs, not proof that an operation is safe.
 * Until real host adapters and independently verified ownership evidence exist,
 * this gate never authorizes an action or a ledger acknowledgement.
 */
export function evaluateSupervisorRecoveryWorker(
  capabilities: SupervisorRecoveryBackendCapabilities,
  _plannedActions: readonly SupervisorRecoveryAction[],
): SupervisorRecoveryWorkerDecision {
  const blockers = REQUIRED_CAPABILITIES
    .filter((capability) => capabilities[capability] !== true)
    .map((capability) => BLOCKER_CODES[capability]);

  // Deliberately hard-disabled: passing the checklist does not itself prove
  // isolation, resource ownership, or that host operations are implemented.
  blockers.push("recovery_executor_not_implemented");

  return Object.freeze({
    ready: false,
    executionEnabled: false,
    claimedRecordMayBeAcknowledged: false,
    executableActions: Object.freeze([]) as readonly [],
    blockers: Object.freeze([...new Set(blockers)]),
  });
}
