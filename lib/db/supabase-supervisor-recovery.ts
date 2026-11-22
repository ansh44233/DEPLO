import type {
  SupervisorRecoveryAction,
  SupervisorRecoveryDisposition,
} from "../../services/build-runner/src/supervisor-recovery";

export type DurableSupervisorRecoveryStatus =
  | "pending"
  | "reconciling"
  | "completed"
  | "blocked";

export type DurableSupervisorRecoveryRecord = Readonly<{
  id: string;
  job_id: string;
  recovery_key: string;
  journal_sequence: number;
  observed_state: "queued" | "preparing" | "starting" | "running" | "stopping" | "succeeded" | "failed" | "cancelled";
  disposition: SupervisorRecoveryDisposition;
  actions: readonly SupervisorRecoveryAction[];
  next_action_index: number;
  status: DurableSupervisorRecoveryStatus;
  claimed_at: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}>;

export class SupervisorRecoveryStoreError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "SupervisorRecoveryStoreError";
  }
}

type StoreConfig = { baseUrl: string; serviceKey: string };
type Fetcher = typeof fetch;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECOVERY_KEY = /^[a-zA-Z0-9_-]{8,128}$/;
const ERROR_CODE = /^[a-z0-9_]{1,64}$/;
const STATES = ["queued", "preparing", "starting", "running", "stopping", "succeeded", "failed", "cancelled"] as const;
const ACTIONS = [
  "inspect_owned_resources",
  "stop_owned_vm_if_present",
  "remove_owned_workspace_if_present",
  "requeue_job",
  "record_recovery_failure",
] as const;
const DISPOSITIONS = [
  "requeue_after_reconciliation",
  "fail_after_reconciliation",
  "preserve_terminal_state",
] as const;
const RECORD_KEYS = [
  "id", "job_id", "recovery_key", "journal_sequence", "observed_state",
  "disposition", "actions", "next_action_index", "status", "claimed_at",
  "error_code", "created_at", "updated_at",
].sort();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

/** Treat database JSON as untrusted input; reject malformed or internally inconsistent rows. */
export function validateDurableSupervisorRecoveryRecord(
  value: unknown,
): DurableSupervisorRecoveryRecord {
  if (!isPlainObject(value) || Object.keys(value).sort().join("|") !== RECORD_KEYS.join("|")) {
    throw new SupervisorRecoveryStoreError("Supervisor recovery storage returned an invalid response.", 502);
  }

  const row = value;
  const state = row.observed_state;
  const actions = row.actions;
  const status = row.status;
  const cursor = row.next_action_index;
  const claimedAt = row.claimed_at;
  const errorCode = row.error_code;

  const commonActions = [
    "inspect_owned_resources",
    "stop_owned_vm_if_present",
    "remove_owned_workspace_if_present",
  ];
  const expectedActions = state === "queued"
    ? [...commonActions, "requeue_job"]
    : state === "preparing" || state === "starting" || state === "running" || state === "stopping"
      ? [...commonActions, "record_recovery_failure"]
      : commonActions;
  const expectedDisposition = state === "queued"
    ? "requeue_after_reconciliation"
    : state === "preparing" || state === "starting" || state === "running" || state === "stopping"
      ? "fail_after_reconciliation"
      : "preserve_terminal_state";

  if (
    typeof row.id !== "string" || !UUID.test(row.id) ||
    typeof row.job_id !== "string" || !UUID.test(row.job_id) ||
    typeof row.recovery_key !== "string" || !RECOVERY_KEY.test(row.recovery_key) ||
    !Number.isSafeInteger(row.journal_sequence) || (row.journal_sequence as number) < 0 ||
    typeof state !== "string" || !(STATES as readonly string[]).includes(state) ||
    row.disposition !== expectedDisposition || !DISPOSITIONS.includes(row.disposition as typeof DISPOSITIONS[number]) ||
    !Array.isArray(actions) || actions.length !== expectedActions.length ||
    actions.some((action, index) => action !== expectedActions[index] || !(ACTIONS as readonly string[]).includes(String(action))) ||
    !Number.isSafeInteger(cursor) || (cursor as number) < 0 || (cursor as number) > actions.length ||
    !["pending", "reconciling", "completed", "blocked"].includes(String(status)) ||
    !(claimedAt === null || validTimestamp(claimedAt)) ||
    !(errorCode === null || (typeof errorCode === "string" && ERROR_CODE.test(errorCode))) ||
    !validTimestamp(row.created_at) || !validTimestamp(row.updated_at) ||
    Date.parse(row.updated_at) < Date.parse(row.created_at)
  ) {
    throw new SupervisorRecoveryStoreError("Supervisor recovery storage returned an invalid response.", 502);
  }

  if (
    (status === "pending" && (cursor !== 0 || claimedAt !== null || errorCode !== null)) ||
    (status === "reconciling" && (cursor === actions.length || claimedAt === null || errorCode !== null)) ||
    (status === "completed" && (cursor !== actions.length || claimedAt !== null || errorCode !== null)) ||
    (status === "blocked" && (cursor === actions.length || claimedAt !== null || errorCode === null))
  ) {
    throw new SupervisorRecoveryStoreError("Supervisor recovery storage returned an invalid response.", 502);
  }

  return Object.freeze({
    id: row.id,
    job_id: row.job_id,
    recovery_key: row.recovery_key,
    journal_sequence: row.journal_sequence as number,
    observed_state: state as DurableSupervisorRecoveryRecord["observed_state"],
    disposition: row.disposition as SupervisorRecoveryDisposition,
    actions: Object.freeze([...actions]) as readonly SupervisorRecoveryAction[],
    next_action_index: cursor as number,
    status: status as DurableSupervisorRecoveryStatus,
    claimed_at: claimedAt as string | null,
    error_code: errorCode as string | null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

function readConfig(env: Record<string, string | undefined>): StoreConfig | null {
  const rawUrl = env.SUPABASE_URL?.trim();
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!rawUrl || !serviceKey) return null;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.hostname !== "localhost") return null;
    return { baseUrl: url.toString().replace(/\/$/, ""), serviceKey };
  } catch {
    return null;
  }
}

function configured(env: Record<string, string | undefined>): StoreConfig {
  const config = readConfig(env);
  if (!config) throw new SupervisorRecoveryStoreError("Supervisor recovery storage is not configured.", 503);
  return config;
}

async function rpc<T>(
  name: string,
  body: Record<string, unknown>,
  env: Record<string, string | undefined>,
  fetcher: Fetcher,
): Promise<T> {
  const config = configured(env);
  let response: Response;
  try {
    response = await fetcher(new URL("/rest/v1/rpc/" + name, config.baseUrl), {
      method: "POST",
      headers: {
        apikey: config.serviceKey,
        Authorization: "Bearer " + config.serviceKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new SupervisorRecoveryStoreError("Supervisor recovery storage is temporarily unavailable.", 502);
  }
  if (!response.ok) {
    throw new SupervisorRecoveryStoreError("Supervisor recovery storage could not complete the request.", 502);
  }
  if (response.status === 204) return undefined as T;
  try {
    return await response.json() as T;
  } catch {
    throw new SupervisorRecoveryStoreError("Supervisor recovery storage returned an invalid response.", 502);
  }
}

function firstRecord(value: unknown): DurableSupervisorRecoveryRecord | null {
  if (!Array.isArray(value)) {
    throw new SupervisorRecoveryStoreError("Supervisor recovery storage returned an invalid response.", 502);
  }
  return value.length === 0 ? null : validateDurableSupervisorRecoveryRecord(value[0]);
}

export async function beginDurableSupervisorRecovery(
  input: {
    jobId: string;
    recoveryKey: string;
    journalSequence: number;
    observedState: DurableSupervisorRecoveryRecord["observed_state"];
    disposition: SupervisorRecoveryDisposition;
    actions: readonly SupervisorRecoveryAction[];
  },
  env: Record<string, string | undefined> = process.env,
  fetcher: Fetcher = fetch,
): Promise<DurableSupervisorRecoveryRecord> {
  const rows = await rpc<unknown>("begin_deplo_build_recovery", {
    p_job_id: input.jobId,
    p_recovery_key: input.recoveryKey,
    p_journal_sequence: input.journalSequence,
    p_observed_state: input.observedState,
    p_disposition: input.disposition,
    p_actions: input.actions,
  }, env, fetcher);
  const record = firstRecord(rows);
  if (!record) throw new SupervisorRecoveryStoreError("Supervisor recovery storage returned no record.", 502);
  return record;
}

/** Claim one pending or expired recovery record. The returned claimed_at is the fencing token. */
export async function claimNextDurableSupervisorRecovery(
  env: Record<string, string | undefined> = process.env,
  fetcher: Fetcher = fetch,
): Promise<DurableSupervisorRecoveryRecord | null> {
  return firstRecord(await rpc<unknown>("claim_next_deplo_build_recovery", {}, env, fetcher));
}

/** Acknowledge only with the exact claimed_at lease token returned by the claim RPC. */
export async function advanceDurableSupervisorRecovery(
  attemptId: string,
  expectedActionIndex: number,
  claimedAt: string,
  env: Record<string, string | undefined> = process.env,
  fetcher: Fetcher = fetch,
): Promise<DurableSupervisorRecoveryRecord> {
  const record = firstRecord(await rpc<unknown>("advance_deplo_build_recovery", {
    p_attempt_id: attemptId,
    p_expected_action_index: expectedActionIndex,
    p_claimed_at: claimedAt,
  }, env, fetcher));
  if (!record) throw new SupervisorRecoveryStoreError("Supervisor recovery storage returned no record.", 502);
  return record;
}

/** Mark a claimed record blocked without exposing free-form errors to storage. */
export async function blockDurableSupervisorRecovery(
  attemptId: string,
  claimedAt: string,
  errorCode: string,
  env: Record<string, string | undefined> = process.env,
  fetcher: Fetcher = fetch,
): Promise<DurableSupervisorRecoveryRecord> {
  const safeErrorCode = /^[a-z0-9_]{1,64}$/.test(errorCode) ? errorCode : "recovery_blocked";
  const record = firstRecord(await rpc<unknown>("block_deplo_build_recovery", {
    p_attempt_id: attemptId,
    p_claimed_at: claimedAt,
    p_error_code: safeErrorCode,
  }, env, fetcher));
  if (!record) throw new SupervisorRecoveryStoreError("Supervisor recovery storage returned no record.", 502);
  return record;
}
