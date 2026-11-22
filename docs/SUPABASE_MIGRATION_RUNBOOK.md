# Supabase database migration runbook

This runbook is the operational checklist for deploying DEPLO's SQL migrations.
It is documentation only: it does not connect to Supabase, apply SQL, or
confirm the state of any remote project.

## Scope and current inventory

Apply the files in `supabase/migrations/` in numeric order. The current
repository inventory is:

| Order | Migration | Purpose |
| --- | --- | --- |
| 0001 | `0001_account_projects.sql` | Account-owned project records |
| 0002 | `0002_github_webhook_deliveries.sql` | Durable GitHub webhook delivery records |
| 0003 | `0003_github_webhook_retries.sql` | Webhook retry and claim coordination |
| 0004 | `0004_github_app_installations.sql` | GitHub App installation mapping |
| 0005 | `0005_github_app_installation_lifecycle.sql` | GitHub App installation lifecycle state |
| 0006 | `0006_durable_build_jobs.sql` | Durable build job records |
| 0007 | `0007_terminalize_exhausted_build_jobs.sql` | Exhausted build-job terminal state handling |
| 0008 | `0008_async_build_runner_jobs.sql` | Asynchronous build-runner job coordination |
| 0009 | `0009_durable_artifact_publication.sql` | Durable artifact publication coordination |
| 0010 | `0010_durable_supervisor_recovery.sql` | Durable supervisor recovery records and RPCs |
| 0011 | `0011_recovery_inventory_nonces.sql` | Job-bound, one-time recovery inventory nonces |
| 0012 | `0012_recovery_inventory_nonce_retention.sql` | Bounded nonce-retention cleanup RPC |

Do not skip a migration or apply 0011/0012 ahead of 0001–0010. If the remote
database has a different migration history, stop and reconcile it before
proceeding; do not mark files as applied manually just to bypass a mismatch.

## Before applying

- [ ] Confirm the target Supabase project/ref with the project owner.
- [ ] Confirm the target is the intended environment (prefer a disposable
      staging project before production).
- [ ] Take and verify a restorable database backup/snapshot using the
      project's approved backup procedure.
- [ ] Review the complete SQL diff from the last known applied migration.
- [ ] Confirm the deployed application version is compatible with the schema.
- [ ] Confirm service-role credentials are available only to trusted
      server-side operators and are not pasted into chat, source control,
      browser code, or build logs.
- [ ] Check the remote migration history and resolve any drift before writing.

## Apply in order

From a trusted operator workstation with the Supabase CLI installed and
authenticated, link the repository to the explicitly confirmed project:

```sh
supabase link --project-ref YOUR_PROJECT_REF
supabase migration list
supabase db push --dry-run
```

Review the dry-run output and verify that it contains only the expected,
pending migrations. If the CLI reports unexpected remote/local history,
stop rather than forcing a repair.

When the target, backup, migration history, and dry-run have all been reviewed,
apply the pending migrations:

```sh
supabase db push
supabase migration list
```

The final migration list should show the repository migrations through
`0012_recovery_inventory_nonce_retention.sql` as applied to the intended
project. Save the command output and deployment timestamp in the team's
operational record. Do not include secrets in that record.

## Post-apply verification

- [ ] Re-run `supabase migration list` and confirm there are no unexpected
      pending or divergent migrations.
- [ ] In the Supabase SQL editor or an approved read-only database session,
      inspect the created tables, RLS settings, function definitions, and
      execute grants against the migration source files.
- [ ] Confirm the recovery nonce table is not accessible to anon or
      authenticated roles and its issue/consume/prune RPCs are restricted to
      service_role, as specified by migrations 0011 and 0012.
- [ ] Confirm the retention RPC enforces a batch size from 1 through 1,000,
      uses bounded row locking, and retains rows for the documented minimum
      seven-day period.
- [ ] Confirm application service-role configuration exists only in trusted
      server-side runtime environments. Never expose the service-role key to
      the dashboard or user-controlled build jobs.
- [ ] Run the repository's CI suite against the deployed application revision.
- [ ] Record verification results and any deviations; do not record secret
      values.

Repository tests include static SQL contract checks. Those checks do not
connect to the target database and are not a substitute for the live
post-apply checks above.

## Recovery safety gates

Applying migrations 0011 and 0012 only creates nonce replay-protection and
retention infrastructure. It does not establish that a host is authentic,
prove that a VM or workspace belongs to a job, or authorize destructive
recovery actions.

Until a separately reviewed and tested trusted-host integration exists:

- Recovery worker execution must remain disabled.
- Recovery inventory verification must continue to return
  `cleanupAuthorized: false`.
- No VM stop, workspace deletion, job requeue, or recovery-ledger
  acknowledgement may be inferred from a valid nonce alone.
- Do not expose nonce issuance, consumption, or pruning to browsers or
  user-controlled build processes.
- The pruning RPC is not scheduled automatically. If a trusted maintenance
  schedule is later introduced, keep calls bounded and monitor failures.

## Failure and rollback handling

If an apply fails or the resulting schema does not match the reviewed
migration:

1. Stop further migrations and stop application rollout if compatibility is
   uncertain.
2. Preserve the CLI output and database error details, after redacting
   credentials and personal data.
3. Compare the remote migration history and actual schema with the migration
   files; do not blindly rerun partially applied SQL.
4. Use the approved restore or forward-fix procedure with a database operator.
   Do not assume these migrations are automatically reversible.
5. Re-run the full post-apply checklist before enabling dependent application
   functionality.

## Current deployment status

This repository documentation does not assert that any migration has been
applied to a live Supabase project. An operator must perform and record the
steps above for each environment.
