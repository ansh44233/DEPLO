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

## Artifact export protocol

A successful runner result exposes an opaque `artifactId`. DEPLO retrieves it only from the configured runner origin using:

- `GET /v1/artifacts/{artifactId}`
- `Authorization: Bearer <DEPLO_BUILD_RUNNER_TOKEN>`
- `Accept: application/zip`
- `Content-Type: application/zip` in the response

The artifact is a ZIP containing the contents of the selected build output directory directly at its root, including a root `index.html`. The runner must keep the artifact immutable and available for retries until DEPLO acknowledges successful publication or the retention window expires.

DEPLO streams the response to private temporary storage with a 100 MiB archive cap, refuses redirects, checks the ZIP signature, and extracts it through the existing path traversal, duplicate-path, symlink, entry-count, expanded-size, and compression-ratio protections. It then independently checks for a root HTML entry point, rejects private/blocked static paths, enforces Cloudflare Pages file limits, and compares extracted file count and bytes with the runner's reported metadata.

The artifact ID is never treated as a URL or filesystem path. The downloader constructs its request from the configured runner origin only.

## Durable artifact publication

A successful runner poll records the artifact metadata and leaves the build job in its processing state. A separate atomic publication claim, introduced by migration `0009_build_artifact_publication.sql`, leases one artifact-ready job at a time. The worker then:

1. Loads the project using both its ID and owner GitHub account ID.
2. Downloads and independently validates the artifact.
3. Resolves the deterministic account/project Cloudflare Pages target and verifies its production branch.
4. Publishes the validated directory to that isolated Pages project.
5. Saves the returned Pages URL to the owner-scoped project record and only then marks the build job succeeded.

Publication claims expire after 10 minutes so abandoned work can be retried. A failed publication uses the existing capped build-job retry policy; a repeated publish targets the same project and production branch. The worker removes temporary artifact files in a `finally` block. The scheduler must invoke `POST /api/internal/build-jobs/process` repeatedly to advance submission, polling, and publication. The route allows up to 300 seconds for artifact retrieval and Pages publishing.

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
- Cloudflare Pages credentials: `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`.

All values are server-only. Migrations `0008_async_build_runner_jobs.sql` and `0009_build_artifact_publication.sql` must be applied to Supabase before enabling the queue worker.

## Current behavior and limitations

The DEPLO worker can now hand off a validated remote artifact to the isolated per-project Cloudflare Pages target and persist the resulting URL. However, this is not an end-to-end live framework deployment until an actual isolated runner service is provisioned, configured, and verified. The DEPLO web host does not execute repository code. Static HTML/ZIP/GitHub deployment paths continue to publish already-static files only.
