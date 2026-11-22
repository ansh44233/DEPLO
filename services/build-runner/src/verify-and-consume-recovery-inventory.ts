import {
  verifySignedRecoveryInventory,
  type RecoveryInventoryVerification,
} from "./signed-recovery-inventory";

export type RecoveryInventoryNonceConsumer = (
  nonce: string,
  jobId: string,
) => Promise<boolean>;

function replayFailure(): RecoveryInventoryVerification {
  return Object.freeze({
    authenticated: false,
    identitiesConsistent: false,
    cleanupAuthorized: false,
    resourceIds: Object.freeze([]),
    blockers: Object.freeze(["inventory_nonce_replayed_or_expired"]),
  });
}

/**
 * Verify a signed inventory and then atomically consume its durable nonce.
 * The supplied consumer must be backed by the service-role database RPC;
 * an in-memory implementation is not sufficient across processes/restarts.
 */
export async function verifyAndConsumeSignedRecoveryInventory(
  envelope: unknown,
  options: Parameters<typeof verifySignedRecoveryInventory>[1],
  consumeNonce: RecoveryInventoryNonceConsumer,
): Promise<RecoveryInventoryVerification> {
  const verification = verifySignedRecoveryInventory(envelope, options);
  if (!verification.authenticated || !verification.identitiesConsistent) return verification;

  try {
    const payload = (envelope as { payload: { nonce: string; jobId: string } }).payload;
    const consumed = await consumeNonce(payload.nonce, payload.jobId);
    return consumed ? verification : replayFailure();
  } catch {
    return replayFailure();
  }
}
