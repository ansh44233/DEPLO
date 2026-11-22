import test from "node:test";
import assert from "node:assert/strict";
import {
  consumeRecoveryInventoryNonce,
  issueRecoveryInventoryNonce,
  RecoveryInventoryNonceStoreError,
} from "../../lib/db/supabase-recovery-inventory-nonces";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "server-only-service-secret",
};
const jobId = "11111111-1111-4111-8111-111111111111";
const nonce = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function response(value: unknown): typeof fetch {
  return async () => Response.json(value);
}

test("issues a fresh UUID challenge bound to the requested job with a 60-second expiry", async () => {
  let requestedUrl = "";
  let body: Record<string, unknown> = {};
  let headers = new Headers();
  let cache: RequestCache | undefined;
  const now = Date.parse("2026-11-22T12:00:00.000Z");
  const result = await issueRecoveryInventoryNonce(jobId, env, async (url, init) => {
    requestedUrl = String(url);
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    headers = new Headers(init?.headers);
    cache = init?.cache;
    return Response.json(true);
  }, now);

  assert.equal(new URL(requestedUrl).pathname, "/rest/v1/rpc/issue_deplo_recovery_inventory_nonce");
  assert.match(result.nonce, /^[0-9a-f-]{36}$/i);
  assert.equal(body.p_nonce, result.nonce);
  assert.equal(body.p_job_id, jobId);
  assert.equal(body.p_expires_at, "2026-11-22T12:01:00.000Z");
  assert.equal(result.expiresAt, body.p_expires_at);
  assert.equal(headers.get("apikey"), env.SUPABASE_SERVICE_ROLE_KEY);
  assert.equal(headers.get("authorization"), "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY);
  assert.equal(cache, "no-store");
  assert.equal(Object.isFrozen(result), true);
});

test("rejects a nonce collision instead of returning an unpersisted challenge", async () => {
  await assert.rejects(
    issueRecoveryInventoryNonce(jobId, env, response(false), 1_000_000),
    (error: unknown) => error instanceof RecoveryInventoryNonceStoreError && error.status === 409,
  );
});

test("rejects invalid job IDs and unsafe clock values before calling storage", async () => {
  let called = false;
  const fetcher: typeof fetch = async () => {
    called = true;
    return Response.json(true);
  };
  await assert.rejects(issueRecoveryInventoryNonce("not-a-uuid", env, fetcher));
  await assert.rejects(issueRecoveryInventoryNonce(jobId, env, fetcher, Number.NaN));
  assert.equal(called, false);
});

test("consumes a nonce through the atomic job-bound RPC and accepts only a boolean result", async () => {
  let requestedUrl = "";
  let body: Record<string, unknown> = {};
  const consumed = await consumeRecoveryInventoryNonce(nonce, jobId, env, async (url, init) => {
    requestedUrl = String(url);
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json([true]);
  });
  assert.equal(consumed, true);
  assert.equal(new URL(requestedUrl).pathname, "/rest/v1/rpc/consume_deplo_recovery_inventory_nonce");
  assert.deepEqual(body, { p_nonce: nonce, p_job_id: jobId });
});

test("returns false for malformed nonce identities without calling storage", async () => {
  let called = false;
  const result = await consumeRecoveryInventoryNonce("bad", jobId, env, async () => {
    called = true;
    return Response.json(true);
  });
  assert.equal(result, false);
  assert.equal(called, false);
});

test("fails closed on non-boolean RPC payloads and provider failures", async () => {
  await assert.rejects(
    consumeRecoveryInventoryNonce(nonce, jobId, env, response({ success: true })),
    (error: unknown) => error instanceof RecoveryInventoryNonceStoreError && error.status === 502,
  );
  const failing: typeof fetch = async () => new Response("private provider details", { status: 500 });
  await assert.rejects(
    consumeRecoveryInventoryNonce(nonce, jobId, env, failing),
    (error: unknown) => error instanceof RecoveryInventoryNonceStoreError
      && !error.message.includes("private provider details"),
  );
});

test("does not expose service credentials in error messages", async () => {
  await assert.rejects(
    consumeRecoveryInventoryNonce(nonce, jobId, { SUPABASE_URL: env.SUPABASE_URL }, response(true)),
    (error: unknown) => error instanceof RecoveryInventoryNonceStoreError
      && !error.message.includes("server-only-service-secret"),
  );
});
