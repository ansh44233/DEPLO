# Isolated framework build runner contract

DEPLO's web application must never execute repository scripts, package lifecycle hooks, or dependency installers in its own process or host filesystem.

## Contract foundation

`lib/deploy/build-runner-contract.ts` defines the provider-neutral request shape, accepted framework/output combinations, and conservative resource defaults. It does not start a process, download source, install dependencies, execute a build, or publish artifacts.

The default request limits are:

- 10-minute wall-clock timeout
- 2 GiB memory and 2 CPU cores
- 4 GiB ephemeral disk
- 5,000 output files and 100 MiB total output
- Network denied by default

A future runner adapter must enforce these limits outside the DEPLO web process. Merely including limits in a request is not enforcement.

## Runner transport client

`lib/deploy/isolated-build-runner.ts` sends the bounded request to the configured runner over HTTPS. It uses a server-only bearer token, refuses redirects, omits cookies, bounds the response size, and validates the returned artifact metadata. It never forwards Cloudflare, Supabase, GitHub App, or session credentials.

This is a transport client only. No build queue worker calls it yet, and it does not download or publish artifacts. A successful runner response is not sufficient to publish until the artifact is fetched through an authenticated artifact channel and independently inspected.

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

- `DEPLO_BUILD_RUNNER_URL`: HTTPS endpoint for the isolated runner (localhost is permitted for local development only).
- `DEPLO_BUILD_RUNNER_TOKEN`: random token of at least 32 characters.

These settings only configure transport to a runner. There is no runner implementation or queue dispatch yet. Do not add either variable to a `NEXT_PUBLIC_` setting.

## Current behavior

Framework detection and the durable build queue remain metadata and queue foundations. Jobs do not execute user code. Static HTML/ZIP/GitHub deployment paths continue to publish already-static files only. Do not mark a build successful or deploy output until a real isolated runner has produced and DEPLO has independently validated an artifact.
