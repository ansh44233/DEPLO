import test from "node:test";
import assert from "node:assert/strict";
import { createSupervisorJournal } from "../../services/build-runner/src/supervisor-event-journal";
import {
  advanceSupervisorRecoveryRecord,
  blockSupervisorRecoveryRecord,
  claimSupervisorRecoveryRecord,
  createSupervisorRecoveryRecord,
} from "../../services/build-runner/src/supervisor-recovery-record";

const JOB_ID = "4e8f6b10-4e1a-4a6e-9b82-3f0a6a7d5c11";

function createRecord() {
  return createSupervisorRecoveryRecord({
    jobId: JOB_ID,
    recoveryKey: "boot_20261122_01",
    journal: createSupervisorJournal(),
  });
}

test("creates a durable recovery record from a validated journal", () => {
  const record = createRecord();
  assert.equal(record.status, "pending");
  assert.equal(record.nextActionIndex, 0);
  assert.equal(record.journalSequence, 0);
  assert.equal(record.disposition, "requeue_after_reconciliation");
  assert.equal(Object.isFrozen(record), true);
  assert.equal(Object.isFrozen(record.actions), true);
});

test("claims a pending record and advances actions with an optimistic cursor", () => {
  let record = claimSupervisorRecoveryRecord(createRecord());
  assert.equal(record.status, "reconciling");
  record = advanceSupervisorRecoveryRecord(record, 0);
  assert.equal(record.nextActionIndex, 1);
  assert.equal(record.status, "reconciling");
  assert.throws(
    () => advanceSupervisorRecoveryRecord(record, 0),
    /supervisor_recovery_action_conflict/,
  );
});

test("marks a record completed only after every planned action is acknowledged", () => {
  let record = claimSupervisorRecoveryRecord(createRecord());
  for (let index = 0; index < record.actions.length; index += 1) {
    record = advanceSupervisorRecoveryRecord(record, index);
  }
  assert.equal(record.status, "completed");
  assert.equal(record.nextActionIndex, record.actions.length);
  assert.throws(
    () => advanceSupervisorRecoveryRecord(record, record.nextActionIndex),
    /supervisor_recovery_action_conflict/,
  );
});

test("blocks a claimed record with a sanitized error code", () => {
  const claimed = claimSupervisorRecoveryRecord(createRecord());
  const blocked = blockSupervisorRecoveryRecord(claimed, "unsafe error text");
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.errorCode, "recovery_blocked");
  assert.equal(blocked.nextActionIndex, 0);
});

test("rejects invalid identifiers and invalid transition order", () => {
  assert.throws(
    () => createSupervisorRecoveryRecord({
      jobId: "not-a-uuid",
      recoveryKey: "boot_20261122_01",
      journal: createSupervisorJournal(),
    }),
    /invalid_supervisor_recovery_record/,
  );
  assert.throws(
    () => advanceSupervisorRecoveryRecord(createRecord(), 0),
    /supervisor_recovery_action_conflict/,
  );
  assert.throws(
    () => claimSupervisorRecoveryRecord(claimSupervisorRecoveryRecord(createRecord())),
    /supervisor_recovery_not_pending/,
  );
});
