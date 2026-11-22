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
  return (value[0] as DurableSupervisorRecoveryRecord | undefined) ?? null;
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
