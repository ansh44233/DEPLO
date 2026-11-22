import { randomUUID } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class RecoveryInventoryNonceStoreError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "RecoveryInventoryNonceStoreError";
  }
}

type Fetcher = typeof fetch;

function readConfig(env: Record<string, string | undefined>) {
  const rawUrl = env.SUPABASE_URL?.trim();
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!rawUrl || !serviceKey) throw new RecoveryInventoryNonceStoreError("Recovery nonce storage is not configured.", 503);
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error("invalid protocol");
    return { baseUrl: url.toString().replace(/\/$/, ""), serviceKey };
  } catch {
    throw new RecoveryInventoryNonceStoreError("Recovery nonce storage is not configured.", 503);
  }
}

async function callBooleanRpc(
  name: string,
  body: Record<string, unknown>,
  env: Record<string, string | undefined>,
  fetcher: Fetcher,
): Promise<boolean> {
  const config = readConfig(env);
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
    throw new RecoveryInventoryNonceStoreError("Recovery nonce storage is temporarily unavailable.", 502);
  }
  if (!response.ok) throw new RecoveryInventoryNonceStoreError("Recovery nonce storage rejected the request.", 502);
  let value: unknown;
  try { value = await response.json(); } catch {
    throw new RecoveryInventoryNonceStoreError("Recovery nonce storage returned an invalid response.", 502);
  }
  if (typeof value === "boolean") return value;
  if (Array.isArray(value) && value.length === 1 && typeof value[0] === "boolean") return value[0];
  throw new RecoveryInventoryNonceStoreError("Recovery nonce storage returned an invalid response.", 502);
}

/** Create a cryptographically random, job-bound challenge with a short lifetime. */
export async function issueRecoveryInventoryNonce(
  jobId: string,
  env: Record<string, string | undefined> = process.env,
  fetcher: Fetcher = fetch,
  nowMs = Date.now(),
): Promise<Readonly<{ nonce: string; expiresAt: string }>> {
  if (!UUID.test(jobId) || !Number.isSafeInteger(nowMs)) {
    throw new RecoveryInventoryNonceStoreError("Invalid recovery nonce request.", 400);
  }
  const nonce = randomUUID();
  const expiresAt = new Date(nowMs + 60_000).toISOString();
  const created = await callBooleanRpc("issue_deplo_recovery_inventory_nonce", {
    p_nonce: nonce,
    p_job_id: jobId,
    p_expires_at: expiresAt,
  }, env, fetcher);
  if (!created) throw new RecoveryInventoryNonceStoreError("Recovery nonce collision; issue a new challenge.", 409);
  return Object.freeze({ nonce, expiresAt });
}

/** Atomically consume a nonce once, bound to the same build job. */
export async function consumeRecoveryInventoryNonce(
  nonce: string,
  jobId: string,
  env: Record<string, string | undefined> = process.env,
  fetcher: Fetcher = fetch,
): Promise<boolean> {
  if (!UUID.test(nonce) || !UUID.test(jobId)) return false;
  return callBooleanRpc("consume_deplo_recovery_inventory_nonce", {
    p_nonce: nonce,
    p_job_id: jobId,
  }, env, fetcher);
}
