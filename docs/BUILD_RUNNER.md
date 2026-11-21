# Isolated framework build runner contract

DEPLO's web application must never execute repository scripts, package lifecycle hooks, or dependency installers in its own process or host filesystem.

## Contract foundation

`lib/deploy/build-runner-contract.ts` defines the provider-neutral request shape, accepted framework/output combinations, and conservative resource defaults. It does not start a process, download source, install dependencies, execute a build, or publish artifacts.

Default request limits are 10 minutes, 2 GiB memory, 2 CPU cores, 4 GiB ephemeral disk, 5,000 output files, 100 MiB total output, and network denied by default. A runner must enforce these limits outside DEPLO; request metadata is not enforcement.

## Authenticated asynchronous protocol

1. DEPLO submits `POST /v1/builds` with a stable `Idempotency-Key` equal to the durable DEPLO build-job UUID.
2. The runner deduplicates repeated submissions by that key and responds with HTTP 202 plus an opaque `runnerJobId`.
3. DEPLO persists the runner ID and polls `GET /v1/builds/{runnerJobId}` from a scheduled background worker.
4. The runner reports `queued`, `running`, `succeeded`, or `failed`; terminal results and artifact metadata are strictly validated.

The transport uses a server-only bearer token, refuses redirects, omits cookies, bounds request timeouts and response sizes, and never forwards Cloudflare, Supabase, GitHub App, or session credentials.

## Queue worker integration

`POST /api/internal/build-jobs/process` is protected by `DEPLO_BUILD_WORKER_SECRET`. A scheduler should call it repeatedly. Each invocation claims at most one poll or one pending build using atomic Supabase RPCs. Runner IDs are persisted in migration `0008_async_build_runner_jobs.sql`; poll claims prevent concurrent workers from updating the same job. Transient failures use the existing retry/backoff policy.

A runner result of `succeeded` is recorded as **artifact-ready**, not as a successful DEPLO deployment. The build job remains processing until a separate artifact-fetch, archive-validation, and Cloudflare publishing pipeline is implemented. No artifact is downloaded or published by this worker.

## Required runner isolation

Before enabling a real runner, its implementation must provide:

1. A disposable VM or strongly isolated container per job; no privileged mode, host sockets, host filesystem mounts, or shared writable workspaces.
2. CPU, memory, process-count, disk, file-count, and wall-clock enforcement.
3. No Cloudflare, Supabase service-role, GitHub App private key, session, or deployment credentials inside the build environment.
4. Explicit dependency-network policy. Build scripts and package lifecycle hooks are untrusted; outbound network should be denied unless a narrowly scoped proxy is required.
5. Exact immutable source commit verification and independent framework/output detection.
6. Artifact export through a separate authenticated channel, with path validation, symlink rejection, file-count/size limits, and immutable artifact IDs.
7. Cancellation, timeout cleanup, per-account concurrency/quotas, audit events, and bounded logs with secret redaction.

## Configuration

- `DEPLO_BUILD_RUNNER_URL`: HTTPS base URL for the isolated runner (localhost is permitted for local development only).
- `DEPLO_BUILD_RUNNER_TOKEN`: random token of at least 32 characters.
- `DEPLO_BUILD_WORKER_SECRET`: random scheduler/worker bearer secret of at least 32 characters.

All three are server-only. The queue worker returns 503 until the runner is configured. Migration `0008_async_build_runner_jobs.sql` must be applied to Supabase before the worker is enabled.

## Current behavior

Framework detection and queue processing remain metadata/protocol foundations until a real isolated runner is deployed. No arbitrary user code is executed by the DEPLO web host. Static HTML/ZIP/GitHub deployment paths continue to publish already-static files only. A remote successful build is not a successful DEPLO deployment until DEPLO independently fetches, validates, and publishes its artifact.
