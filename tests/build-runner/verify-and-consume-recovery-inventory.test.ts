import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyAndConsumeSignedRecoveryInventory } from "../../services/build-runner/src/verify-and-consume-recovery-inventory";

const secret = "test-only-secret-with-at-least-32-bytes";
const jobId = "11111111-1111-4111-8111-111111111111";
const nonce = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const workspace = {
  kind: "workspace" as const,
  resourceId: "workspace-1",
  jobId,
  ownershipToken: "22222222-2222-4222-8222-222222222222",
};
const options = {
  secret,
  expectedNonce: nonce,
  expectedJobId: jobId,
  expectedResources: [workspace],
  nowMs: 1_000_100,
};

function envelope() {
  const payload = { version: 1, nonce, issuedAtMs: 1_000_000, jobId, resources: [workspace] };
  const canonical = JSON.stringify({
    ...payload,
    resources: payload.resources.map((resource) => ({
      kind: resource.kind,
      resourceId: resource.resourceId,
      jobId: resource.jobId,
      ownershipToken: resource.ownershipToken,
    })),
  });
  return { payload, signature: createHmac("sha256", secret).update(canonical).digest("hex") };
}

test("consumes a valid nonce after successful authentication and identity checks", async () => {
  const calls: string[][] = [];
  const result = await verifyAndConsumeSignedRecoveryInventory(
    envelope(), options,
    async (receivedNonce, receivedJobId) => {
      calls.push([receivedNonce, receivedJobId]);
      return true;
    },
  );
  assert.equal(result.authenticated, true);
  assert.equal(result.identitiesConsistent, true);
  assert.equal(result.cleanupAuthorized, false);
  assert.deepEqual(calls, [[nonce, jobId]]);
});

test("fails closed when the nonce was already consumed or expired", async () => {
  let calls = 0;
  const result = await verifyAndConsumeSignedRecoveryInventory(
    envelope(), options,
    async () => { calls += 1; return false; },
  );
  assert.equal(calls, 1);
  assert.equal(result.authenticated, false);
  assert.equal(result.cleanupAuthorized, false);
  assert.deepEqual(result.blockers, ["inventory_nonce_replayed_or_expired"]);
});

test("does not consume a nonce when signature or identity verification fails", async () => {
  let calls = 0;
  const invalid = { ...envelope(), signature: "0".repeat(64) };
  const result = await verifyAndConsumeSignedRecoveryInventory(
    invalid, options,
    async () => { calls += 1; return true; },
  );
  assert.equal(calls, 0);
  assert.equal(result.authenticated, false);
  assert.equal(result.cleanupAuthorized, false);
});

test("fails closed when durable nonce storage is unavailable", async () => {
  const result = await verifyAndConsumeSignedRecoveryInventory(
    envelope(), options,
    async () => { throw new Error("storage unavailable"); },
  );
  assert.equal(result.authenticated, false);
  assert.equal(result.cleanupAuthorized, false);
  assert.deepEqual(result.blockers, ["inventory_nonce_replayed_or_expired"]);
});
