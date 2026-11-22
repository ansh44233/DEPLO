import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifySignedRecoveryInventory } from "../../services/build-runner/src/signed-recovery-inventory";

const secret = "test-only-secret-with-at-least-32-bytes";
const jobId = "11111111-1111-4111-8111-111111111111";
const nonce = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const workspace = {
  kind: "workspace" as const,
  resourceId: "workspace-1",
  jobId,
  ownershipToken: "22222222-2222-4222-8222-222222222222",
};

function signedEnvelope(overrides: Record<string, unknown> = {}) {
  const payload = {
    version: 1,
    nonce,
    issuedAtMs: 1_000_000,
    jobId,
    resources: [workspace],
    ...overrides,
  };
  const canonical = JSON.stringify({
    version: payload.version,
    nonce: payload.nonce,
    issuedAtMs: payload.issuedAtMs,
    jobId: payload.jobId,
    resources: (payload.resources as typeof workspace[]).map((resource) => ({
      kind: resource.kind,
      resourceId: resource.resourceId,
      jobId: resource.jobId,
      ownershipToken: resource.ownershipToken,
    })),
  });
  return {
    payload,
    signature: createHmac("sha256", secret).update(canonical).digest("hex"),
  };
}

const options = {
  secret,
  expectedNonce: nonce,
  expectedJobId: jobId,
  expectedResources: [workspace],
  nowMs: 1_000_100,
};

test("accepts a valid fresh signed inventory but never authorizes cleanup", () => {
  const result = verifySignedRecoveryInventory(signedEnvelope(), options);
  assert.equal(result.authenticated, true);
  assert.equal(result.identitiesConsistent, true);
  assert.equal(result.cleanupAuthorized, false);
  assert.deepEqual(result.resourceIds, ["workspace-1"]);
  assert.deepEqual(result.blockers, []);
});

test("rejects signature tampering", () => {
  const envelope = signedEnvelope();
  envelope.payload.issuedAtMs = 1_000_101;
  const result = verifySignedRecoveryInventory(envelope, options);
  assert.deepEqual(result.blockers, ["inventory_signature_mismatch"]);
  assert.equal(result.cleanupAuthorized, false);
});

test("rejects wrong nonce, stale and future snapshots", () => {
  assert.deepEqual(
    verifySignedRecoveryInventory(signedEnvelope({ nonce: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }), options).blockers,
    ["inventory_nonce_mismatch"],
  );
  assert.deepEqual(
    verifySignedRecoveryInventory(signedEnvelope({ issuedAtMs: 900_000 }), options).blockers,
    ["inventory_snapshot_stale"],
  );
  assert.deepEqual(
    verifySignedRecoveryInventory(signedEnvelope({ issuedAtMs: 1_010_000 }), options).blockers,
    ["inventory_snapshot_stale"],
  );
});

test("rejects cross-job and identity mismatches after authenticating the host", () => {
  const result = verifySignedRecoveryInventory(signedEnvelope({
    resources: [{ ...workspace, ownershipToken: "33333333-3333-4333-8333-333333333333" }],
  }), options);
  assert.equal(result.authenticated, true);
  assert.equal(result.identitiesConsistent, false);
  assert.equal(result.cleanupAuthorized, false);
  assert.deepEqual(result.blockers, ["resource_identity_mismatch"]);
});

test("rejects malformed envelopes and weak verification secrets", () => {
  assert.deepEqual(
    verifySignedRecoveryInventory({ ...signedEnvelope(), extra: true }, options).blockers,
    ["invalid_inventory_envelope"],
  );
  assert.deepEqual(
    verifySignedRecoveryInventory(signedEnvelope(), { ...options, secret: "short" }).blockers,
    ["invalid_inventory_verification_config"],
  );
});

test("rejects oversized inventories and malformed resource records", () => {
  assert.deepEqual(
    verifySignedRecoveryInventory(signedEnvelope({ resources: Array(33).fill(workspace) }), options).blockers,
    ["invalid_inventory_resources"],
  );
  assert.deepEqual(
    verifySignedRecoveryInventory(signedEnvelope({ resources: [{ ...workspace, extra: true }] }), options).blockers,
    ["invalid_inventory_resources"],
  );
});

test("rejects throwing accessors without opening the gate", () => {
  const hostile = Object.defineProperty({}, "payload", {
    enumerable: true,
    get() { throw new Error("untrusted"); },
  });
  const result = verifySignedRecoveryInventory(hostile, options);
  assert.equal(result.authenticated, false);
  assert.equal(result.cleanupAuthorized, false);
});
