import {
  validateSupervisorJournal,
  type SupervisorJournal,
} from "./supervisor-event-journal";
import type { SupervisorState } from "./supervisor-lifecycle";

export type SupervisorRecoveryDisposition =
  | "requeue_after_reconciliation"
  | "fail_after_reconciliation"
  | "preserve_terminal_state";

export type SupervisorRecoveryAction =
  | "inspect_owned_resources"
  | "stop_owned_vm_if_present"
  | "remove_owned_workspace_if_present"
  | "requeue_job"
  | "record_recovery_failure";

export type SupervisorRecoveryPlan = Readonly<{
  disposition: SupervisorRecoveryDisposition;
  observedState: SupervisorState;
  actions: readonly SupervisorRecoveryAction[];
  automaticBuildResume: false;
}>;

const TERMINAL_STATES = new Set<SupervisorState>([
  "succeeded",
  "failed",
  "cancelled",
]);

/**
 * Produce a conservative recovery plan from a validated journal snapshot.
 *
 * This is a pure decision function. It does not inspect the host, stop a VM,
 * remove a workspace, persist state, or prove that a resource belongs to a job.
 * A future trusted recovery worker must authenticate resource ownership and
 * complete reconciliation before performing any action in the returned plan.
 */
export function planSupervisorCrashRecovery(
  journal: SupervisorJournal,
): SupervisorRecoveryPlan {
  validateSupervisorJournal(journal);

  const commonActions: SupervisorRecoveryAction[] = [
    "inspect_owned_resources",
    "stop_owned_vm_if_present",
    "remove_owned_workspace_if_present",
  ];

  if (journal.state === "queued") {
    return Object.freeze({
      disposition: "requeue_after_reconciliation",
      observedState: journal.state,
      actions: Object.freeze([...commonActions, "requeue_job"]),
      automaticBuildResume: false,
    });
  }

  if (TERMINAL_STATES.has(journal.state)) {
    return Object.freeze({
      disposition: "preserve_terminal_state",
      observedState: journal.state,
      actions: Object.freeze(commonActions),
      automaticBuildResume: false,
    });
  }

  return Object.freeze({
    disposition: "fail_after_reconciliation",
    observedState: journal.state,
    actions: Object.freeze([...commonActions, "record_recovery_failure"]),
    automaticBuildResume: false,
  });
}
