# Isolated framework build runner contract

DEPLO's web application must never execute repository scripts, package lifecycle hooks, or dependency installers in its own process or host filesystem.

## Authenticated source handoff

Before submitting a build, DEPLO obtains the exact requested commit archive from GitHub using a short-lived GitHub App installation token with read-only Contents and Metadata permissions. The token is held only in the DEPLO worker process and is never sent to the build runner.

The source handoff is:

1. DEPLO fetches `GET https://api.github.com/repos/{owner}/{repo}/zipball/{commitSha}`; the final archive host must be `api.github.com` or `codeload.github.com`.
2. DEPLO enforces a 25 MiB compressed archive cap and validates the ZIP signature.
3. DEPLO uploads multipart form data to `POST /v1/sources` with the authenticated runner bearer token, an `Idempotency-Key` equal to the durable DEPLO build-job UUID, a `metadata` JSON field (`repositoryFullName`, `sourceCommitSha`), and an `archive` ZIP file.
4. The runner returns HTTP 201 (or an idempotent HTTP 200) with an opaque `sourceId`. The runner must bind that ID to the exact commit, repository, archive digest, and idempotency key; conflicting retries must be rejected.
5. DEPLO submits `POST /v1/builds` with the opaque `sourceId`, exact commit SHA, framework, package manager, output directory, and resource limits. The same job UUID is the build idempotency key.

The runner independently validates each archive during intake by extracting it into a private temporary directory using DEPLO's shared safe ZIP extractor, then removes that temporary directory before persisting the immutable archive. This rejects malformed ZIPs, path traversal, duplicate paths, symlinks, special files, excessive entry counts, expanded size, and compression ratios. A future build sandbox must re-validate and extract the archive inside its own isolated workspace; it must not trust a repository name or commit string as a path. The source archive is never executed during intake.

## Asynchronous build protocol

The runner responds to `POST /v1/builds` with HTTP 202 and an opaque `runnerJobId`, deduplicating repeated submissions by the idempotency key. DEPLO persists the runner ID and polls `GET /v1/builds/{runnerJobId}`. Status is `queued`, `running`, `succeeded`, or `failed`.

A successful result exposes an opaque `artifactId`. DEPLO stores the artifact metadata and releases the runner-poll lease. A separate atomic publication lease then claims the artifact-ready job, downloads it only from the configured runner origin using `GET /v1/artifacts/{artifactId}`, bearer authentication, and `Accept: application/zip`. The ZIP must contain a root `index.html`. DEPLO enforces a 100 MiB cap, safely extracts it, checks file counts and bytes against runner metadata, and publishes validated static output to the project's isolated Cloudflare Pages site. Publication leases expire after 10 minutes, avoiding overlap with the shorter runner-poll lease and allowing abandoned publication work to be retried.

## Isolation requirements

- Disposable VM or strongly isolated container per job; no privileged mode, host sockets, host filesystem mounts, or shared writable workspaces.
- Enforce CPU, memory, process-count, disk, file-count, and wall-clock limits outside DEPLO.
- Never expose Cloudflare, Supabase service-role, GitHub App private key, session, or deployment credentials to project build code.
- Dependency networking denied by default; any required package access must use a constrained proxy with domain and bandwidth policy.
- Verify immutable source commit and independently detect framework/output configuration.
- Export immutable artifacts through a separate authenticated channel.
- Support cancellation, timeout cleanup, per-account concurrency/quotas, audit events, bounded logs, and secret redaction.

## Configuration

- `DEPLO_BUILD_RUNNER_URL`: HTTPS runner base URL (localhost only for local development).
- `DEPLO_BUILD_RUNNER_TOKEN`: random server-only token of at least 32 characters.
- `DEPLO_BUILD_WORKER_SECRET`: random server-only scheduler/worker token of at least 32 characters.
- `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY`: GitHub App credentials used only by DEPLO to issue short-lived read-only installation tokens.

## Current behavior and deployment prerequisites

The DEPLO worker now stages an exact GitHub commit archive and sends it to the runner before build submission. The runner service itself is not deployed by this repository yet. Source intake now includes an authenticated maintenance endpoint that removes archives older than seven days in bounded batches, along with matching idempotency records. Schedule `POST /v1/maintenance/cleanup` from trusted infrastructure; do not expose the runner maintenance route publicly. No arbitrary project code is executed by the DEPLO web host. Actual framework builds remain unavailable until a runner implements the source, build, status, and artifact endpoints with the isolation guarantees above and is deployed/configured. Supabase migrations `0006` through `0009` must also be applied before the queue is enabled.
