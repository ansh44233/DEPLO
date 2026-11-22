# Durable recovery inventory nonces

Migration `0011_recovery_inventory_nonces.sql` adds a service-role-only,
job-bound nonce ledger. A trusted supervisor creates a cryptographically
random UUID challenge before requesting an inventory snapshot. The issue RPC
stores it with a short expiry (the adapter uses 60 seconds; the database caps
the accepted lifetime at two minutes).

After HMAC signature, freshness, job binding, and exact resource identity
checks pass, the verifier calls the atomic consume RPC. The database updates
only a matching, unexpired, unconsumed nonce. Concurrent/replayed requests
cannot both consume the same row successfully. Nonces are bound to one job.

The verifier fails closed if nonce consumption returns false or storage is
unavailable. Invalid signatures/identities do not consume a nonce.

## Required integration

- Apply migration 0011 after migrations 0001–0010.
- Use the service-role adapter only inside trusted server-side supervisor code.
- Do not expose issue/consume RPCs to browsers or user-controlled build processes.
- Keep host signing-key provisioning, supervisor authentication, nonce issuance
  and consume calls behind the trusted control plane.
- Schedule bounded cleanup of expired/consumed rows after the maximum audit
  retention window is decided.

This is replay protection groundwork, not proof that the signer is a genuine
host, not host inventory attestation, and not permission to stop VMs or remove
workspaces. `cleanupAuthorized` remains false. Recovery worker execution,
ledger acknowledgement, and arbitrary build execution remain disabled.
