import test from "node:test";
import assert from "node:assert/strict";
import { transitionSupervisorState } from "../../services/build-runner/src/supervisor-lifecycle";

test("requires host preflight before startup and verified controls before running", () => {
  assert.equal(transitionSupervisorState("queued", "prepare"), "preparing");
  assert.throws(() => transitionSupervisorState("preparing", "start"), /host_preflight_required/);
  assert.equal(transitionSupervisorState("preparing", "start", { hostPreflightPassed: true }), "starting");
  assert.throws(() => transitionSupervisorState("starting", "started", {
    vmIsolationVerified: true, resourceLimitsVerified: true,
  }), /network_isolation_not_verified/);
  assert.equal(transitionSupervisorState("starting", "started", {
    vmIsolationVerified: true,
    resourceLimitsVerified: true,
    networkIsolationVerified: true,
  }), "running");
});

test("success requires a stopped VM, validated artifact, and completed cleanup", () => {
  assert.equal(transitionSupervisorState("running", "stop"), "stopping");
  assert.throws(() => transitionSupervisorState("stopping", "succeed", {
    vmStopped: true, artifactValidated: true,
  }), /cleanup_must_complete/);
  assert.equal(transitionSupervisorState("stopping", "succeed", {
    vmStopped: true, artifactValidated: true, cleanupComplete: true,
  }), "succeeded");
});

test("failure and cancellation cannot become terminal before teardown", () => {
  assert.throws(() => transitionSupervisorState("running", "fail"), /vm_must_be_stopped/);
  assert.equal(transitionSupervisorState("running", "fail", {
    vmStopped: true, cleanupComplete: true,
  }), "failed");
  assert.equal(transitionSupervisorState("queued", "cancel"), "cancelled");
  assert.throws(() => transitionSupervisorState("stopping", "cancel", {
    vmStopped: true,
  }), /cleanup_must_complete/);
});

test("rejects illegal transitions and all transitions from terminal states", () => {
  assert.throws(() => transitionSupervisorState("queued", "started"), /invalid_supervisor_transition/);
  assert.throws(() => transitionSupervisorState("succeeded", "fail"), /supervisor_state_terminal/);
  assert.throws(() => transitionSupervisorState("cancelled", "prepare"), /supervisor_state_terminal/);
});
