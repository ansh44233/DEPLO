# DEPLO Build Runner (source-intake foundation)

This service is intentionally separate from the DEPLO Next.js application. It accepts authenticated source archives and stores them as private, immutable ZIP blobs. It does **not** unpack archives, install dependencies, run build scripts, or execute repository code.

## Run locally

Set an absolute private data directory and a random token of at least 32 characters:

```sh
DEPLO_RUNNER_TOKEN="$(openssl rand -hex 32)" \
DEPLO_RUNNER_DATA_DIR="/var/lib/deplo-runner" \
PORT=8788 npx tsx services/build-runner/src/server.ts
```

The HTTP server limits headers to 15 seconds, request-body receipt to 120 seconds, keep-alive to 5 seconds, header size to 16 KiB, header count to 50, and requests per socket to 100. These limits reduce slow-client and oversized-header exposure; they do not replace network-level rate limiting.

The process exposes `GET /healthz` and authenticated `POST /v1/sources`. Source intake accepts the multipart contract documented in `docs/BUILD_RUNNER.md`, caps the body, validates metadata and ZIP magic bytes, and persists a SHA-256-bound source ID. Repeating the same idempotency key and exact source returns the same ID; a conflicting retry returns 409.

The source directory must be on a private persistent filesystem with access restricted to the runner service account. Do not mount it into build containers.\n\nAn authenticated `POST /v1/maintenance/cleanup` removes source archives older than seven days and their matching idempotency records. Each invocation removes at most 100 sources; schedule it periodically from trusted infrastructure. Recent sources are retained. The endpoint returns removed source/record counts and bytes freed.

## Deliberately disabled

`POST /v1/builds` returns HTTP 503 with `sandbox_not_configured`. This is intentional: source intake is not a sandbox. Do not enable build execution until disposable VM/container isolation, network policy, resource enforcement, cancellation, artifact export, and cleanup have been implemented and independently tested.
