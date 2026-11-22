# Recovery resource identity contract (data-only)

`src/recovery-resource-identity.ts` compares the resource identities recorded
for a job with an observed inventory snapshot. It requires exact resource kind,
resource ID, job UUID, and ownership-token agreement; rejects duplicate,
missing, unexpected, malformed, or cross-job entries; and bounds inventories
to 32 entries.

A clean comparison means only that the supplied values are internally
consistent. This module does **not** authenticate the inventory source, verify
that a token was issued by a trusted host supervisor, inspect filesystem or VM
state, detect stale snapshots, or prove that a resource is safe to remove.
Caller-supplied identity fields can be forged.

Accordingly, every assessment permanently reports
`trustedEvidence: false` and `cleanupAuthorized: false`, even when there
are no blockers. Do not use this result to stop a VM, remove a workspace,
requeue a job, or acknowledge a recovery ledger action. A future executor
requires an authenticated host inventory adapter, durable token issuance and
binding, freshness/replay protection, independent ownership checks, and
idempotent host operations. Build execution remains disabled.
