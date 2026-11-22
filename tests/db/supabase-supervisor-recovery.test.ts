import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceDurableSupervisorRecovery,
  beginDurableSupervisorRecovery,
  blockDurableSupervisorRecovery,
  claimNextDurableSupervisorRecovery,
  listDurableSupervisorRecoveriesForJobs,
  SupervisorRecoveryStoreError,
  type DurableSupervisorRecoveryRecord,
} from "../../lib/db/supabase-supervisor-recovery";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "server-only-service-secret",
};
const record: DurableSupervisorRecoveryRecord = {
  id: "00000000-0000-4000-8000-000000000010",
  job_id: "00000000-0000-4000-8000-000000000001",
  recovery_key: "boot_20261122_01",
  journal_sequence: 0,
  observed_state: "queued",
  disposition: "requeue_after_reconciliation",
  actions: [
    "inspect_owned_resources",
    "stop_owned_vm_if_present",
    "remove_owned_workspace_if_present",
    "requeue_job",
  ],
  next_action_index: 0,
  status: "pending",
  claimed_at: null,
  error_code: null,
  created_at: "2026-11-22T00:00:00.000Z",
  updated_at: "2026-11-22T00:00:00.000Z",
};

function fetcher(payload: unknown, capture: (url: string, body: Record<string, unknown>, headers: Headers) => void = () => undefined): typeof fetch {
  return async (url, init) => {
    capture(String(url), init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}, new Headers(init?.headers));
    return Response.json(payload);
  };
}

test("persists an immutable recovery plan using the service-only RPC", async () => {
  let requested = "";
  let body: Record<string, unknown> = {};
  let headers = new Headers();
  const result = await beginDurableSupervisorRecovery({
    jobId: record.job_id,
    recoveryKey: record.recovery_key,
    journalSequence: 0,
    observedState: "queued",
    disposition: "requeue_after_reconciliation",
    actions: record.actions,
  }, env, fetcher([record], (url, data, h) => { requested = url; body = data; headers = h; }));
  assert.equal(new URL(requested).pathname, "/rest/v1/rpc/begin_deplo_build_recovery");
  assert.equal(body.p_job_id, record.job_id);
  assert.deepEqual(body.p_actions, record.actions);
  assert.equal(headers.get("apikey"), env.SUPABASE_SERVICE_ROLE_KEY);
  assert.equal(result.id, record.id);
});

test("claims a recovery record and preserves the lease fencing token", async () => {
  let requested = "";
  const claimed = { ...record, status: "reconciling" as const, claimed_at: "2026-11-22T01:00:00.000Z" };
  const result = await claimNextDurableSupervisorRecovery(env, fetcher([claimed], (url) => { requested = url; }));
  assert.equal(new URL(requested).pathname, "/rest/v1/rpc/claim_next_deplo_build_recovery");
  assert.equal(result?.claimed_at, claimed.claimed_at);
});

test("advances exactly one action with expected cursor and lease token", async () => {
  let body: Record<string, unknown> = {};
  const next = { ...record, status: "reconciling" as const, claimed_at: "2026-11-22T01:00:00.000Z", next_action_index: 1 };
  await advanceDurableSupervisorRecovery(record.id, 0, next.claimed_at!, env, fetcher([next], (_url, data) => { body = data; }));
  assert.deepEqual(body, {
    p_attempt_id: record.id,
    p_expected_action_index: 0,
    p_claimed_at: next.claimed_at,
  });
});

test("blocks a recovery attempt with a sanitized error code and its lease token", async () => {
  let body: Record<string, unknown> = {};
  const blocked = { ...record, status: "blocked" as const, claimed_at: null, error_code: "recovery_blocked" };
  await blockDurableSupervisorRecovery(record.id, "2026-11-22T01:00:00.000Z", "unsafe error text", env,
    fetcher([blocked], (_url, data) => { body = data; }));
  assert.equal(body.p_error_code, "recovery_blocked");
  assert.equal(body.p_claimed_at, "2026-11-22T01:00:00.000Z");
});

test("rejects missing configuration and malformed RPC responses", async () => {
  await assert.rejects(
    claimNextDurableSupervisorRecovery({}),
    (error: unknown) => error instanceof SupervisorRecoveryStoreError && error.status === 503,
  );
  await assert.rejects(
    claimNextDurableSupervisorRecovery(env, fetcher({ id: record.id })),
    /invalid response/,
  );
});

test("rejects recovery records with unknown fields or malformed action data", async () => {
  const withUnknownField = { ...record, private_payload: "must-not-cross-trust-boundary" };
  await assert.rejects(
    claimNextDurableSupervisorRecovery(env, fetcher([withUnknownField])),
    /invalid record/,
  );
  const withUnknownAction = { ...record, actions: ["execute_arbitrary_command"] };
  await assert.rejects(
    claimNextDurableSupervisorRecovery(env, fetcher([withUnknownAction])),
    /invalid record/,
  );
});

test("rejects inconsistent lease and terminal status combinations", async () => {
  const unleasedActive = { ...record, status: "reconciling" };
  await assert.rejects(
    claimNextDurableSupervisorRecovery(env, fetcher([unleasedActive])),
    /invalid record/,
  );
  const incompleteTerminal = { ...record, status: "completed" };
  await assert.rejects(
    claimNextDurableSupervisorRecovery(env, fetcher([incompleteTerminal])),
    /invalid record/,
  );
});

test("does not leak provider response details on failure", async () => {
  const failing: typeof fetch = async () => new Response("private provider diagnostic", { status: 500 });
  await assert.rejects(
    claimNextDurableSupervisorRecovery(env, failing),
    (error: unknown) => error instanceof SupervisorRecoveryStoreError && !error.message.includes("private provider diagnostic"),
  );
});


test("lists recovery attempts only for supplied owner-scoped job IDs", async () => {
  let requested = "";
  let headers = new Headers();
  const rows = await listDurableSupervisorRecoveriesForJobs([record.job_id], env,
    async (url, init) => {
      requested = String(url);
      headers = new Headers(init?.headers);
      return Response.json([record]);
    });
  const url = new URL(requested);
  assert.equal(url.pathname, "/rest/v1/build_job_recovery_attempts");
  assert.equal(url.searchParams.get("job_id"), "in.(" + record.job_id + ")");
  assert.equal(url.searchParams.get("limit"), "100");
  assert.equal(headers.get("apikey"), env.SUPABASE_SERVICE_ROLE_KEY);
  assert.deepEqual(rows.map((row) => row.id), [record.id]);
});

test("returns no recovery attempts without querying storage when there are no jobs", async () => {
  let called = false;
  const rows = await listDurableSupervisorRecoveriesForJobs([], env, async () => {
    called = true;
    return Response.json([]);
  });
  assert.deepEqual(rows, []);
  assert.equal(called, false);
});

test("rejects malformed job IDs and invalid recovery history rows", async () => {
  await assert.rejects(
    listDurableSupervisorRecoveriesForJobs(["not-a-uuid"], env),
    (error: unknown) => error instanceof SupervisorRecoveryStoreError && error.status === 400,
  );
  await assert.rejects(
    listDurableSupervisorRecoveriesForJobs([record.job_id], env,
      async () => Response.json([{ ...record, internal_payload: "must-not-be-returned" }])),
    /invalid record/,
  );
});
