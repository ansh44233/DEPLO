# Upload archive safety policy

DEPLO treats every uploaded archive as untrusted input. ZIP files are stored as opaque bytes until an authenticated extraction request is made.

## Enforced extraction controls

The server-side extractor:

1. Rejects absolute paths, drive-prefixed paths, parent-directory traversal, backslashes, control characters, and malformed path segments.
2. Limits archives to 2,000 entries.
3. Limits total expanded content to 100 MiB.
4. Rejects any entry with a compression ratio above 100:1.
5. Rejects duplicate paths, symbolic links, and special filesystem entries.
6. Validates actual decompressed byte counts while streaming; metadata checks alone are not trusted.
7. Extracts into a new private directory using restrictive permissions and removes partial output if extraction fails.
8. Never executes user-provided build commands. Build execution requires a separate sandbox with CPU, memory, process, network, and time limits.

The extractor uses the ZIP central directory for metadata and streams entry contents instead of buffering entire expanded files. It still requires operational limits at the hosting layer, including request timeouts, disk quotas, rate limiting, and cleanup.

## Upload storage configuration

- Configure `DEPLO_UPLOAD_TOKEN` with a unique random secret of at least 32 characters. Keep it server-side; never expose it to browser JavaScript.
- Optionally configure `DEPLO_UPLOAD_DIR` to a private persistent directory outside the public web root.
- Local filesystem storage is intended for a persistent Node.js host. Ephemeral serverless filesystems are not supported by this adapter.
- The current bearer token is a shared gate, not account-level authorization. Do not expose the endpoint publicly until account authentication, per-user quotas, rate limiting, and cleanup are added.

## Current limitations

Extraction output remains private and cannot yet be served as a deployed website. Project ownership, account authentication, quotas, cleanup, object storage, build execution, deployment providers, and live deployment URLs remain future work.
