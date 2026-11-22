import test from "node:test";
import assert from "node:assert/strict";
import { assessRecoveryResourceIdentities } from "../../services/build-runner/src/recovery-resource-identity";

const jobId = "11111111-1111-4111-8111-111111111111";
const workspace = {
  kind: "workspace",
  resourceId: "job-abc123",
  jobId,
  ownershipToken: "22222222-2222-4222-8222-222222222222",
} as const;
const vm = {
  kind: "vm",
  resourceId: "vm-abc123",
  jobId,
  ownershipToken: "33333333-3333-4333-8333-333333333333",
} as const;

test("matching expected and observed identities are internally consistent only", () => {
  const assessment = assessRecoveryResourceIdentities(jobId, [workspace, vm], [vm, workspace]);
  assert.equal(assessment.identitiesConsistent, true);
  assert.equal(assessment.trustedEvidence, false);
  assert.equal(assessment.cleanupAuthorized, false);
  assert.deepEqual(assessment.matchedResourceIds, ["job-abc123", "vm-abc123"]);
  assert.deepEqual(assessment.blockers, []);
});

test("missing resources fail closed", () => {
  const assessment = assessRecoveryResourceIdentities(jobId, [workspace, vm], [workspace]);
  assert.equal(assessment.identitiesConsistent, false);
  assert.deepEqual(assessment.blockers, ["resource_identity_missing"]);
  assert.equal(assessment.cleanupAuthorized, false);
});

test("ownership-token mismatch is not accepted as the expected resource", () => {
  const assessment = assessRecoveryResourceIdentities(jobId, [workspace], [{
    ...workspace,
    ownershipToken: "44444444-4444-4444-8444-444444444444",
  }]);
  assert.deepEqual(assessment.blockers, ["resource_identity_mismatch"]);
  assert.deepEqual(assessment.matchedResourceIds, []);
});

test("unexpected and duplicate resources are rejected", () => {
  const unexpected = assessRecoveryResourceIdentities(jobId, [workspace], [workspace, vm]);
  assert.deepEqual(unexpected.blockers, ["unexpected_resource_identity"]);

  const duplicate = assessRecoveryResourceIdentities(jobId, [workspace, workspace], [workspace]);
  assert.deepEqual(duplicate.blockers, ["resource_identity_ambiguous"]);
});

test("job identity mismatch is rejected", () => {
  const assessment = assessRecoveryResourceIdentities(
    jobId,
    [workspace],
    [{ ...workspace, jobId: "55555555-5555-4555-8555-555555555555" }],
  );
  assert.deepEqual(assessment.blockers, ["resource_identity_job_mismatch"]);
});

test("malformed values, unknown fields, and oversized inventories are rejected", () => {
  const malformed = [
    null,
    {},
    { ...workspace, extra: true },
    { ...workspace, ownershipToken: "not-a-token" },
  ];
  for (const item of malformed) {
    const assessment = assessRecoveryResourceIdentities(jobId, [item], []);
    assert.deepEqual(assessment.blockers, ["invalid_resource_identity_input"]);
    assert.equal(assessment.cleanupAuthorized, false);
  }
  assert.deepEqual(
    assessRecoveryResourceIdentities(jobId, Array(33).fill(workspace), []).blockers,
    ["invalid_resource_identity_input"],
  );
});

test("throwing getters fail closed", () => {
  const hostile = Object.defineProperty({}, "kind", {
    enumerable: true,
    get() { throw new Error("untrusted accessor"); },
  });
  const assessment = assessRecoveryResourceIdentities(jobId, [hostile], []);
  assert.deepEqual(assessment.blockers, ["invalid_resource_identity_input"]);
  assert.equal(assessment.trustedEvidence, false);
  assert.equal(assessment.cleanupAuthorized, false);
});

test("assessment and result arrays are immutable", () => {
  const assessment = assessRecoveryResourceIdentities(jobId, [workspace], [workspace]);
  assert.equal(Object.isFrozen(assessment), true);
  assert.equal(Object.isFrozen(assessment.matchedResourceIds), true);
  assert.equal(Object.isFrozen(assessment.blockers), true);
});
