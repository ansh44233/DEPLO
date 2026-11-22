# DEPLO Build Runner (source-intake foundation)

This service is intentionally separate from the DEPLO Next.js application. It accepts authenticated source archives, safely extracts each archive into a private temporary directory for validation, removes that temporary directory, and stores the original ZIP as a private immutable blob. It does **not** retain extracted source files, install dependencies, run build scripts, or execute repository code.

## Run locally

Set an absolute private data directory and a random token of at least 32 characters:

```sh
DEPLO_RUNNER_TOKEN="$(openssl rand -hex 32)" \
DEPLO_RUNNER_DATA_DIR="/var/lib/deplo-runner" \
DEPLO_RUNNER_WORKSPACE_DIR="/var/lib/deplo-workspaces" \
DEPLO_RUNNER_HOST="127.0.0.1" PORT=8788 npx tsx services/build-runner/src/server.ts
```

The runner binds to loopback (`127.0.0.1`) by default. `DEPLO_RUNNER_HOST` may be set to a private or link-local IP address when the DEPLO application reaches the runner over a private network; public and wildcard bind addresses are rejected. Keep the service behind private networking and a firewall even with bearer authentication. The HTTP server limits headers to 15 seconds, request-body receipt to 120 seconds, keep-alive to 5 seconds, header size to 16 KiB, header count to 50, and requests per socket to 100. These limits reduce slow-client and oversized-header exposure; they do not replace network-level rate limiting.

The process exposes `GET /healthz` and authenticated `POST /v1/sources`. Source intake accepts the multipart contract documented in `docs/BUILD_RUNNER.md`, caps the body, validates metadata and ZIP structure, then applies safe extraction checks for traversal, duplicate paths, symlinks, special files, entry count, expanded size, and compression ratio before persisting a SHA-256-bound source ID. Repeating the same idempotency key and exact source returns the same ID; a conflicting retry returns 409.

The source directory must be on a private persistent filesystem with access restricted to the runner service account. Do not mount it into build containers.

## Operator diagnostics

`GET /v1/diagnostics` requires the runner bearer token. It reports the Node runtime platform/architecture, whether source and workspace storage are configured, and explicit execution readiness flags. The endpoint deliberately reports `backendConfigured: false`, `resourceLimitsEnforced: false`, `networkEgressDenied: false`, and `buildsEnabled: false` until a real isolation backend is installed and verified. It also checks for a Linux host, a KVM device, configured Firecracker and jailer executables, kernel/initrd images, and cgroup v2 CPU/memory/PID controllers. Configure `DEPLO_FIRECRACKER_BIN`, `DEPLO_FIRECRACKER_JAILER_BIN`, `DEPLO_FIRECRACKER_KERNEL`, and `DEPLO_FIRECRACKER_INITRD` to inventory those files. Only booleans and stable blocker codes are returned; filesystem paths, credentials, and environment values are never exposed. These checks are preflight inventory only: the Firecracker execution backend is not implemented, resource limits are not enforced, network egress is not denied, and builds remain disabled. This is not a security attestation.

## Maintenance

An authenticated `POST /v1/maintenance/cleanup` removes source archives older than seven days and matching idempotency records (maximum 100 per call). If `DEPLO_RUNNER_WORKSPACE_DIR` is configured, it also removes up to 100 stale `job-*` workspace directories older than 24 hours. Symlink roots and entries are rejected or skipped, unrelated files are untouched, and cleanup returns removed counts and bytes freed. Per-workspace atomic operation locks coordinate janitor deletion with heartbeat and managed cleanup on the same filesystem. Stale locks left by crashed processes are skipped for manual inspection rather than force-reclaimed. Schedule this endpoint periodically from trusted infrastructure. The workspace retention must remain substantially longer than the maximum enforced build wall-clock duration; do not run untrusted builds without a real supervisor and sandbox.

## Deliberately disabled

`POST /v1/builds` returns HTTP 503 with `sandbox_not_configured`. This is intentional: source intake and workspace cleanup are not a sandbox. Do not enable build execution until disposable VM isolation, network policy, resource enforcement, cancellation, artifact export, and cleanup have been implemented and independently tested.

## Supervisor crash-recovery contract

`src/supervisor-recovery.ts` derives a conservative, immutable recovery plan from a validated supervisor journal:

- Queued jobs may be requeued only after a trusted worker reconciles any job-owned VM/workspace resources.
- Interrupted active jobs (preparing, starting, running, stopping) must be failed closed after resource reconciliation; they are never automatically resumed.
- Terminal outcomes are preserved while leftover job-owned resources are reconciled.

The planner is data-only. It does not persist journals, inspect host resources, stop VMs, delete workspaces, or authenticate resource ownership. A future recovery worker must verify ownership before acting, make each operation idempotent, and durably record its result. A journal snapshot alone cannot prove that a VM or workspace is absent. Build execution remains disabled.
