import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSupervisorRecoveryWorker } from "../../services/build-runner/src/supervisor-recovery-worker";

const allCapabilities = {
  hostInventory: true,
  ownershipVerification: true,
  vmControl: true,
  workspaceCleanup: true,
  jobQueueControl: true,
} as const;

test("worker remains disabled when every backend capability is absent", () => {
  const decision = evaluateSupervisorRecoveryWorker({
    hostInventory: false,
    ownershipVerification: false,
    vmControl: false,
    workspaceCleanup: false,
    jobQueueControl: false,
  }, ["inspect_owned_resources", "stop_owned_vm_if_present"]);
  assert.equal(decision.ready, false);
  assert.equal(decision.executionEnabled, false);
  assert.equal(decision.claimedRecordMayBeAcknowledged, false);
  assert.deepEqual(decision.executableActions, []);
  assert.deepEqual(decision.blockers, [
    "host_inventory_unavailable",
    "resource_ownership_unverified",
    "vm_control_unavailable",
    "workspace_cleanup_unavailable",
    "job_queue_control_unavailable",
    "recovery_executor_not_implemented",
  ]);
});

test("capability flags alone never authorize actions or acknowledgements", () => {
  const decision = evaluateSupervisorRecoveryWorker(allCapabilities, [
    "inspect_owned_resources",
    "stop_owned_vm_if_present",
    "remove_owned_workspace_if_present",
    "requeue_job",
  ]);
  assert.equal(decision.ready, false);
  assert.equal(decision.executionEnabled, false);
  assert.equal(decision.claimedRecordMayBeAcknowledged, false);
  assert.deepEqual(decision.executableActions, []);
  assert.deepEqual(decision.blockers, ["recovery_executor_not_implemented"]);
});

test("decision is immutable and independent of the supplied action list", () => {
  const actions = ["inspect_owned_resources"] as const;
  const decision = evaluateSupervisorRecoveryWorker(allCapabilities, actions);
  assert.equal(Object.isFrozen(decision), true);
  assert.equal(Object.isFrozen(decision.blockers), true);
  assert.equal(Object.isFrozen(decision.executableActions), true);
  assert.deepEqual(decision.executableActions, []);
});
