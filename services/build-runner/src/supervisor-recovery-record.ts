import type { SupervisorJournal } from "./supervisor-event-journal";
import {
  planSupervisorCrashRecovery,
  type SupervisorRecoveryAction,
  type SupervisorRecoveryDisposition,
} from "./supervisor-recovery";
import type { SupervisorState } from "./supervisor-lifecycle";

export type SupervisorRecoveryRecordStatus =
  | "pending"
  | "reconciling"
  | "completed"
  | "blocked";

export type SupervisorRecoveryRecord = Readonly<{
  jobId: string;
  recoveryKey: string;
  journalSequence: number;
  observedState: SupervisorState;
  disposition: SupervisorRecoveryDisposition;
  actions: readonly SupervisorRecoveryAction[];
  nextActionIndex: number;
  status: SupervisorRecoveryRecordStatus;
  errorCode: string | null;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECOVERY_KEY = /^[a-zA-Z0-9_-]{8,128}$/;
const ERROR_CODE = /^[a-z0-9_]{1,64}$/;

/** Create the immutable first version of a durable recovery ledger record. */
export function createSupervisorRecoveryRecord(input: {
  jobId: string;
  recoveryKey: string;
  journal: SupervisorJournal;
}): SupervisorRecoveryRecord {
  if (!input || typeof input !== "object" || !UUID.test(input.jobId) || !RECOVERY_KEY.test(input.recoveryKey)) {
    throw new Error("invalid_supervisor_recovery_record");
  }
  const plan = planSupervisorCrashRecovery(input.journal);
  return Object.freeze({
    jobId: input.jobId,
    recoveryKey: input.recoveryKey,
    journalSequence: input.journal.sequence,
    observedState: plan.observedState,
    disposition: plan.disposition,
    actions: Object.freeze([...plan.actions]),
    nextActionIndex: 0,
    status: "pending",
    errorCode: null,
  });
}

/** Pure claim transition. Database leases remain the source of concurrency control. */
export function claimSupervisorRecoveryRecord(
  record: SupervisorRecoveryRecord,
): SupervisorRecoveryRecord {
  validateRecord(record);
  if (record.status !== "pending") throw new Error("supervisor_recovery_not_pending");
  return Object.freeze({ ...record, status: "reconciling" });
}

/** Acknowledge one completed action using optimistic cursor matching. */
export function advanceSupervisorRecoveryRecord(
  record: SupervisorRecoveryRecord,
  expectedActionIndex: number,
): SupervisorRecoveryRecord {
  validateRecord(record);
  if (
    record.status !== "reconciling" ||
    !Number.isSafeInteger(expectedActionIndex) ||
    expectedActionIndex !== record.nextActionIndex ||
    expectedActionIndex >= record.actions.length
  ) {
    throw new Error("supervisor_recovery_action_conflict");
  }
  const nextActionIndex = record.nextActionIndex + 1;
  return Object.freeze({
    ...record,
    nextActionIndex,
    status: nextActionIndex === record.actions.length ? "completed" : "reconciling",
  });
}

/** Stop reconciliation without guessing whether an unconfirmed host action ran. */
export function blockSupervisorRecoveryRecord(
  record: SupervisorRecoveryRecord,
  errorCode: string,
): SupervisorRecoveryRecord {
  validateRecord(record);
  if (record.status !== "reconciling") throw new Error("supervisor_recovery_not_active");
  const safeErrorCode = ERROR_CODE.test(errorCode) ? errorCode : "recovery_blocked";
  return Object.freeze({
    ...record,
    status: "blocked",
    errorCode: safeErrorCode,
  });
}

function validateRecord(record: SupervisorRecoveryRecord): void {
  if (
    !record ||
    typeof record !== "object" ||
    !UUID.test(record.jobId) ||
    !RECOVERY_KEY.test(record.recoveryKey) ||
    !Number.isSafeInteger(record.journalSequence) ||
    record.journalSequence < 0 ||
    !Array.isArray(record.actions) ||
    record.actions.length < 1 ||
    record.actions.length > 5 ||
    !Number.isSafeInteger(record.nextActionIndex) ||
    record.nextActionIndex < 0 ||
    record.nextActionIndex > record.actions.length ||
    !["pending", "reconciling", "completed", "blocked"].includes(record.status)
  ) {
    throw new Error("invalid_supervisor_recovery_record");
  }
  if (record.status === "completed" && record.nextActionIndex !== record.actions.length) {
    throw new Error("invalid_supervisor_recovery_record");
  }
  if (record.status === "blocked" && record.errorCode === null) {
    throw new Error("invalid_supervisor_recovery_record");
  }
}
