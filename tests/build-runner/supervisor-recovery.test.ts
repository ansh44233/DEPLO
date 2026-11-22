import test from "node:test";
import assert from "node:assert/strict";
import {
  appendSupervisorEvent,
  createSupervisorJournal,
} from "../../services/build-runner/src/supervisor-event-journal";
import { planSupervisorCrashRecovery } from "../../services/build-runner/src/supervisor-recovery";

function journalAt(state: "queued" | "preparing" | "starting" | "running" | "stopping" | "failed" | "succeeded" | "cancelled") {
  let journal = createSupervisorJournal();
  let second = 0;
  const append = (
    event: "prepare" | "start" | "started" | "stop" | "succeed" | "fail" | "cancel",
    evidence: Record<string, boolean> = {},
  ) => {
    second += 1;
    journal = appendSupervisorEvent(journal, {
      eventId: `event_${String(second).padStart(4, "0")}`,
      event,
      occurredAt: new Date(Date.UTC(2026, 10, 22, 0, 0, second)).toISOString(),
      evidence,
    });
  };

  if (state === "queued") return journal;
  append("prepare");
  if (state === "preparing") return journal;
  append("start", { hostPreflightPassed: true });
  if (state === "starting") return journal;
  append("started", {
    vmIsolationVerified: true,
    resourceLimitsVerified: true,
    networkIsolationVerified: true,
  });
  if (state === "running") return journal;
  append("stop");
  if (state === "stopping") return journal;
  if (state === "failed") {
    append("fail", { vmStopped: true, cleanupComplete: true });
    return journal;
  }
  if (state === "cancelled") {
    append("cancel", { vmStopped: true, cleanupComplete: true });
    return journal;
  }
  append("succeed", {
    vmStopped: true,
    artifactValidated: true,
    cleanupComplete: true,
  });
  return journal;
}

test("queued jobs are requeued only after resource reconciliation", () => {
  const plan = planSupervisorCrashRecovery(journalAt("queued"));
  assert.equal(plan.disposition, "requeue_after_reconciliation");
  assert.deepEqual(plan.actions, [
    "inspect_owned_resources",
    "stop_owned_vm_if_present",
    "remove_owned_workspace_if_present",
    "requeue_job",
  ]);
  assert.equal(plan.automaticBuildResume, false);
});

test("every non-terminal active state fails closed after cleanup", () => {
  for (const state of ["preparing", "starting", "running", "stopping"] as const) {
    const plan = planSupervisorCrashRecovery(journalAt(state));
    assert.equal(plan.disposition, "fail_after_reconciliation", state);
    assert.equal(plan.observedState, state);
    assert.equal(plan.actions.at(-1), "record_recovery_failure");
    assert.equal(plan.automaticBuildResume, false);
  }
});

test("terminal jobs preserve their outcome while orphan resources are reconciled", () => {
  for (const state of ["succeeded", "failed", "cancelled"] as const) {
    const plan = planSupervisorCrashRecovery(journalAt(state));
    assert.equal(plan.disposition, "preserve_terminal_state", state);
    assert.deepEqual(plan.actions, [
      "inspect_owned_resources",
      "stop_owned_vm_if_present",
      "remove_owned_workspace_if_present",
    ]);
  }
});

test("rejects corrupted journal snapshots instead of producing a recovery plan", () => {
  const journal = journalAt("running");
  const corrupted = { ...journal, state: "queued" as const };
  assert.throws(
    () => planSupervisorCrashRecovery(corrupted),
    /invalid_supervisor_journal_snapshot/,
  );
});

test("recovery plans and action lists are immutable", () => {
  const plan = planSupervisorCrashRecovery(journalAt("starting"));
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.actions), true);
});
