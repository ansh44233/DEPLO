import test from "node:test";
import assert from "node:assert/strict";
import { claimDeploySlot, deploysPerHour, rateLimitMessage } from "../../lib/db/supabase-deploy-rate-limit";

const env = { SUPABASE_URL: "https://db.example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service" };

test("asks the database for a slot with the configured limit", async () => {
  let body: unknown = null;
  const fetcher = (async (input: string | URL | Request, init: RequestInit = {}) => {
    assert.equal(String(input), "https://db.example.supabase.co/rest/v1/rpc/claim_deploy_slot");
    body = JSON.parse(String(init.body));
    return Response.json(0);
  }) as typeof fetch;
  assert.deepEqual(await claimDeploySlot(42, { ...env, DEPLO_DEPLOYS_PER_HOUR: "5" }, fetcher), { allowed: true });
  assert.deepEqual(body, { p_owner_github_id: 42, p_limit: 5, p_window_seconds: 3600 });
});

test("refuses with a wait time when the account is over its limit", async () => {
  const slot = await claimDeploySlot(42, env, (async () => Response.json(125)) as typeof fetch);
  assert.deepEqual(slot, { allowed: false, retryAfterSeconds: 125 });
  assert.equal(rateLimitMessage(slot as { allowed: false; retryAfterSeconds: number }), "Too many deploys from this account. Try again in 3 minutes.");
});

test("fails open when the limit is off, unconfigured, unmigrated or unreachable", async () => {
  const never = (async () => { throw new Error("should not be called"); }) as typeof fetch;
  assert.deepEqual(await claimDeploySlot(42, { ...env, DEPLO_DEPLOYS_PER_HOUR: "0" }, never), { allowed: true });
  assert.deepEqual(await claimDeploySlot(42, {}, never), { allowed: true });
  const errors: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { errors.push(args); };
  try {
    assert.deepEqual(await claimDeploySlot(42, env, (async () => new Response("missing", { status: 404 })) as typeof fetch), { allowed: true });
    assert.deepEqual(await claimDeploySlot(42, env, (async () => { throw new Error("down"); }) as typeof fetch), { allowed: true });
  } finally { console.error = original; }
  assert.equal(errors.length, 2, "the operator is told the limit is not working");
});

test("reads the per-hour limit safely", () => {
  assert.equal(deploysPerHour({}), 30);
  assert.equal(deploysPerHour({ DEPLO_DEPLOYS_PER_HOUR: "100" }), 100);
  assert.equal(deploysPerHour({ DEPLO_DEPLOYS_PER_HOUR: "-1" }), 30);
  assert.equal(deploysPerHour({ DEPLO_DEPLOYS_PER_HOUR: "lots" }), 30);
});
