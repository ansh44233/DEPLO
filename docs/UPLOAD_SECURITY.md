# Upload archive safety policy

DEPLO treats uploaded archives as untrusted input. Before any archive is extracted, the server-side pipeline must:

1. Reject absolute paths, drive-prefixed paths, parent-directory traversal, backslashes, control characters, and malformed path segments.
2. Limit archives to 2,000 entries.
3. Limit total expanded content to 100 MiB.
4. Reject any entry with a compression ratio above 100:1.
5. Validate actual decompressed byte counts while streaming; metadata checks alone are not sufficient.
6. Extract only into an isolated per-upload workspace and ensure resolved destinations remain inside that workspace.
7. Never execute user-provided build commands on the web application server. Builds require a separate sandbox with CPU, memory, process, network, and time limits.

The current archive-policy module implements pure metadata/path checks and is covered by unit tests. It does not parse ZIP files, extract files, store uploads, or make deployment possible by itself. The future extractor must enforce these rules again while processing actual archive data, because archive metadata is untrusted.