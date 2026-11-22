export type RecoveryResourceKind = "workspace" | "vm";

export type RecoveryResourceIdentity = Readonly<{
  kind: RecoveryResourceKind;
  resourceId: string;
  jobId: string;
  ownershipToken: string;
}>;

export type RecoveryResourceIdentityAssessment = Readonly<{
  identitiesConsistent: boolean;
  trustedEvidence: false;
  cleanupAuthorized: false;
  matchedResourceIds: readonly string[];
  blockers: readonly string[];
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const IDENTITY_KEYS = ["kind", "resourceId", "jobId", "ownershipToken"];

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseIdentity(value: unknown): RecoveryResourceIdentity | null {
  if (!isPlainRecord(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.join("|") !== [...IDENTITY_KEYS].sort().join("|")) return null;
  if (
    (value.kind !== "workspace" && value.kind !== "vm") ||
    typeof value.resourceId !== "string" || !RESOURCE_ID.test(value.resourceId) ||
    typeof value.jobId !== "string" || !UUID.test(value.jobId) ||
    typeof value.ownershipToken !== "string" || !UUID.test(value.ownershipToken)
  ) return null;
  return value as RecoveryResourceIdentity;
}

function result(blockers: readonly string[], matchedResourceIds: readonly string[] = []): RecoveryResourceIdentityAssessment {
  const uniqueBlockers = [...new Set(blockers)];
  return Object.freeze({
    identitiesConsistent: uniqueBlockers.length === 0,
    trustedEvidence: false,
    cleanupAuthorized: false,
    matchedResourceIds: Object.freeze([...matchedResourceIds]),
    blockers: Object.freeze(uniqueBlockers),
  });
}

/**
 * Compares expected resource identities with a host-inventory snapshot.
 *
 * A successful comparison is only an identity-consistency result. The snapshot
 * is not authenticated here and may be stale or forged; this function never
 * authorizes cleanup, VM control, or recovery-ledger acknowledgement.
 */
export function assessRecoveryResourceIdentities(
  expectedJobId: unknown,
  expectedResources: unknown,
  observedResources: unknown,
): RecoveryResourceIdentityAssessment {
  try {
    if (
      typeof expectedJobId !== "string" || !UUID.test(expectedJobId) ||
      !Array.isArray(expectedResources) || !Array.isArray(observedResources) ||
      expectedResources.length > 32 || observedResources.length > 32
    ) return result(["invalid_resource_identity_input"]);

    const expected = expectedResources.map(parseIdentity);
    const observed = observedResources.map(parseIdentity);
    if (expected.some(item => item === null) || observed.some(item => item === null)) {
      return result(["invalid_resource_identity_input"]);
    }

    const expectedItems = expected as RecoveryResourceIdentity[];
    const observedItems = observed as RecoveryResourceIdentity[];
    if (
      expectedItems.some(item => item.jobId !== expectedJobId) ||
      observedItems.some(item => item.jobId !== expectedJobId)
    ) return result(["resource_identity_job_mismatch"]);

    const key = (item: RecoveryResourceIdentity) => item.kind + ":" + item.resourceId;
    const expectedKeys = expectedItems.map(key);
    const observedKeys = observedItems.map(key);
    if (new Set(expectedKeys).size !== expectedKeys.length || new Set(observedKeys).size !== observedKeys.length) {
      return result(["resource_identity_ambiguous"]);
    }

    const blockers: string[] = [];
    const matched: string[] = [];
    for (const item of expectedItems) {
      const matches = observedItems.filter(candidate => key(candidate) === key(item));
      if (matches.length === 0) {
        blockers.push("resource_identity_missing");
        continue;
      }
      if (
        matches.length !== 1 ||
        matches[0].jobId !== item.jobId ||
        matches[0].ownershipToken !== item.ownershipToken
      ) {
        blockers.push("resource_identity_mismatch");
        continue;
      }
      matched.push(item.resourceId);
    }

    if (observedItems.some(item => !expectedKeys.includes(key(item)))) {
      blockers.push("unexpected_resource_identity");
    }
    return result(blockers, matched);
  } catch {
    return result(["invalid_resource_identity_input"]);
  }
}
