# Signed recovery inventory verification (foundation only)

`src/signed-recovery-inventory.ts` verifies a versioned host inventory envelope
using HMAC-SHA256, a minimum 32-byte UTF-8 secret, constant-time signature
comparison, an exact payload schema, a request-bound UUID nonce, a job binding,
and a short timestamp freshness window (60 seconds; 5 seconds of future skew).
The resource list is bounded to 32 entries and is compared against the job's
expected identities using the existing exact identity contract.

## Trust boundary

A successful result means the payload was signed by a party holding the shared
secret, is fresh, matches the caller's challenge nonce and job, and has
internally consistent resource identities. It does not prove that the signer
is a genuine host supervisor unless secret distribution and host process
isolation are independently secured.

The caller must generate unpredictable one-time nonces and consume each nonce
atomically after successful verification. This module does not persist or
prevent nonce reuse itself. Key rotation, secret storage, host enrollment,
transport authentication, and durable replay protection remain integration
work.

Even successful verification always returns `cleanupAuthorized: false`.
This module does not inspect host state, stop VMs, remove workspaces, requeue
jobs, or acknowledge recovery records. It is not wired into the recovery
worker. Do not enable build execution or cleanup based on this foundation.
