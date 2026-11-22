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
const DISPOSITIONS = ["requeue_after_reconciliation", "fail_after_reconciliation", "preserve_terminal_state"] as const;
const ACTIONS = [
  "inspect_owned_resources",
  "stop_owned_vm_if_present",
  "remove_owned_workspace_if_present",
  "requeue_job",
  "record_recovery_failure",
] as const;
const STATUSES = ["pending", "reconciling", "completed", "blocked"] as const;
const RECORD_KEYS = [
  "id", "job_id", "recovery_key", "journal_sequence", "observed_state",
  "disposition", "actions", "next_action_index", "status", "claimed_at",
  "error_code", "created_at", "updated_at",
];

function invalidRecord(): never {
  throw new SupervisorRecoveryStoreError("Supervisor recovery storage returned an invalid record.", 502);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && value.endsWith("Z");
}

/** Treat the database response as untrusted input before any worker uses it. */
function parseRecord(value: unknown): DurableSupervisorRecoveryRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalidRecord();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join("|") !== [...RECORD_KEYS].sort().join("|")) return invalidRecord();
  if (
    typeof row.id !== "string" || !UUID.test(row.id) ||
    typeof row.job_id !== "string" || !UUID.test(row.job_id) ||
    typeof row.recovery_key !== "string" || !RECOVERY_KEY.test(row.recovery_key) ||
    !Number.isSafeInteger(row.journal_sequence) || (row.journal_sequence as number) < 0 ||
    !STATES.includes(row.observed_state as typeof STATES[number]) ||
    !DISPOSITIONS.includes(row.disposition as typeof DISPOSITIONS[number]) ||
    !Array.isArray(row.actions) || row.actions.length < 1 || row.actions.length > 5 ||
    row.actions.some(action => !ACTIONS.includes(action as typeof ACTIONS[number])) ||
    !Number.isSafeInteger(row.next_action_index) || (row.next_action_index as number) < 0 ||
    (row.next_action_index as number) > row.actions.length ||
    !STATUSES.includes(row.status as typeof STATUSES[number]) ||
    !(row.claimed_at === null || isTimestamp(row.claimed_at)) ||
    !(row.error_code === null || (typeof row.error_code === "string" && ERROR_CODE.test(row.error_code))) ||
    !isTimestamp(row.created_at) || !isTimestamp(row.updated_at)
  ) return invalidRecord();

  if (
    (row.status === "pending" && (row.next_action_index !== 0 || row.claimed_at !== null || row.error_code !== null)) ||
    (row.status === "reconciling" && (row.claimed_at === null || row.error_code !== null || row.next_action_index === row.actions.length)) ||
    (row.status === "completed" && (row.next_action_index !== row.actions.length || row.error_code !== null)) ||
    (row.status === "blocked" && (row.error_code === null || row.claimed_at !== null))
  ) return invalidRecord();

  return Object.freeze({
    id: row.id as string,
    job_id: row.job_id as string,
    recovery_key: row.recovery_key as string,
    journal_sequence: row.journal_sequence as number,
    observed_state: row.observed_state as DurableSupervisorRecoveryRecord["observed_state"],
    disposition: row.disposition as SupervisorRecoveryDisposition,
    actions: Object.freeze([...(row.actions as SupervisorRecoveryAction[])]),
    next_action_index: row.next_action_index as number,
    status: row.status as DurableSupervisorRecoveryStatus,
    claimed_at: row.claimed_at as string | null,
    error_code: row.error_code as string | null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
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
  return value.length === 0 ? null : parseRecord(value[0]);
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
  const safeErrorCode = ERROR_CODE.test(errorCode) ? errorCode : "recovery_blocked";
  const record = firstRecord(await rpc<unknown>("block_deplo_build_recovery", {
    p_attempt_id: attemptId,
    p_claimed_at: claimedAt,
    p_error_code: safeErrorCode,
  }, env, fetcher));
  if (!record) throw new SupervisorRecoveryStoreError("Supervisor recovery storage returned no record.", 502);
  return record;
}


/**
 * List recovery history only for job IDs already verified against the signed-in
 * owner's project. The caller must never pass arbitrary, unowned job IDs.
 */
export async function listDurableSupervisorRecoveriesForJobs(
  jobIds: readonly string[],
  env: Record<string, string | undefined> = process.env,
  fetcher: Fetcher = fetch,
): Promise<DurableSupervisorRecoveryRecord[]> {
  if (jobIds.length === 0) return [];
  if (jobIds.length > 50 || jobIds.some((id) => !UUID.test(id))) {
    throw new SupervisorRecoveryStoreError("Invalid recovery history query.", 400);
  }
  const config = configured(env);
  const url = new URL("/rest/v1/build_job_recovery_attempts", config.baseUrl);
  url.searchParams.set("select", RECORD_KEYS.join(","));
  url.searchParams.set("job_id", "in.(" + jobIds.join(",") + ")");
  url.searchParams.set("order", "created_at.desc");
  url.searchParams.set("limit", "100");
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "GET",
      headers: {
        apikey: config.serviceKey,
        Authorization: "Bearer " + config.serviceKey,
        "Content-Type": "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new SupervisorRecoveryStoreError("Supervisor recovery storage is temporarily unavailable.", 502);
  }
  if (!response.ok) {
    throw new SupervisorRecoveryStoreError("Supervisor recovery storage could not complete the request.", 502);
  }
  let rows: unknown;
  try { rows = await response.json(); } catch {
    throw new SupervisorRecoveryStoreError("Supervisor recovery storage returned an invalid response.", 502);
  }
  if (!Array.isArray(rows)) {
    throw new SupervisorRecoveryStoreError("Supervisor recovery storage returned an invalid response.", 502);
  }
  return rows.map(parseRecord);
}
