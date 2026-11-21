# Upload archive safety policy

DEPLO treats uploaded archives as untrusted input. Before any archive is extracted, the server-side pipeline must:

1. Reject absolute paths, drive-prefixed paths, parent-directory traversal, backslashes, control characters, and malformed path segments.
2. Limit archives to 2,000 entries.
3. Limit total expanded content to 100 MiB.
4. Reject any entry with a compression ratio above 100:1.
5. Validate actual decompressed byte counts while streaming; metadata checks alone are not sufficient.
6. Extract only into an isolated per-upload workspace and ensure resolved destinations remain inside that workspace.
7. Never execute user-provided build commands on the web application server. Builds require a separate sandbox with CPU, memory, process, network, and time limits.

The authenticated upload endpoint stores original ZIP/HTML bytes in a private local directory on a persistent Node.js host. It does not parse or extract ZIP files, execute user code, or deploy sites. The archive-policy module implements pure metadata/path checks and is covered by unit tests. A future extractor must enforce these rules again while processing actual archive data, because archive metadata is untrusted.

## Upload storage configuration

- Configure `DEPLO_UPLOAD_TOKEN` with a unique random secret of at least 32 characters. Keep it server-side; never expose it to browser JavaScript.
- Optionally configure `DEPLO_UPLOAD_DIR` to a private persistent directory outside the public web root.
- Local filesystem storage is intended for a persistent Node.js host. Ephemeral serverless filesystems are not supported by this adapter.
- The current bearer token is a shared gate, not account-level authorization. Do not expose the endpoint publicly until account authentication, per-user quotas, rate limiting, and cleanup are added.
