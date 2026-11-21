# DEPLO Build Runner (source-intake foundation)

This service is intentionally separate from the DEPLO Next.js application. It accepts authenticated source archives and stores them as private, immutable ZIP blobs. It does **not** unpack archives, install dependencies, run build scripts, or execute repository code.

## Run locally

Set an absolute private data directory and a random token of at least 32 characters:

```sh
DEPLO_RUNNER_TOKEN="$(openssl rand -hex 32)" \
DEPLO_RUNNER_DATA_DIR="/var/lib/deplo-runner" \
PORT=8788 npx tsx services/build-runner/src/server.ts
```

The process exposes `GET /healthz` and authenticated `POST /v1/sources`. Source intake accepts the multipart contract documented in `docs/BUILD_RUNNER.md`, caps the body, validates metadata and ZIP magic bytes, and persists a SHA-256-bound source ID. Repeating the same idempotency key and exact source returns the same ID; a conflicting retry returns 409.

The source directory must be on a private persistent filesystem with access restricted to the runner service account. Do not mount it into build containers.

## Deliberately disabled

`POST /v1/builds` returns HTTP 503 with `sandbox_not_configured`. This is intentional: source intake is not a sandbox. Do not enable build execution until disposable VM/container isolation, network policy, resource enforcement, cancellation, artifact export, and cleanup have been implemented and independently tested.
