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

## Retention and maintenance

Migration `0012_recovery_inventory_nonce_retention.sql` adds a service-role-only
pruning RPC. It deletes at most the requested batch size (1–1,000; default
200) and only rows whose expiry or consumption timestamp is older than seven
days. Row locks use `SKIP LOCKED`, so concurrent maintenance calls do not
select the same rows. A trusted scheduler may invoke this RPC periodically;
the function does not run automatically.

The seven-day window is a fixed minimum retention period for operational
investigation. Adjust it only through a reviewed migration after deciding the
platform's audit and privacy requirements.

## Required integration

- Apply migrations 0011 and 0012 after migrations 0001–0010, in order.
- Use the service-role adapter and maintenance RPC only inside trusted
  server-side control-plane code.
- Do not expose issue/consume/prune RPCs to browsers or user-controlled build
  processes.
- Keep host signing-key provisioning, supervisor authentication, nonce
  issuance and consume calls behind the trusted control plane.
- Schedule bounded pruning only after deployment and database migration.

This is replay-protection groundwork, not proof that the signer is a genuine
host, not host inventory attestation, and not permission to stop VMs or remove
workspaces. `cleanupAuthorized` remains false. Recovery worker execution,
ledger acknowledgement, and arbitrary build execution remain disabled.
