# Changelog

All notable changes to DEPLO are documented here.

## Unreleased

### Added
- Streaming ZIP extraction into private per-upload directories with path traversal, duplicate-path, symlink, entry-count, expanded-size, and compression-ratio checks.
- Authenticated ZIP extraction endpoint and integration tests for successful extraction, malformed archives, archive bombs, and symbolic links.
- Authenticated server-side upload endpoint with private local filesystem storage and metadata sidecars for ZIP and HTML files.
- Shared bearer-token validation using constant-time comparison and server-side upload configuration.
- Server-side content checks, request-size limits, and upload authentication tests.
- Archive path traversal checks and metadata limits for the future ZIP extraction pipeline.
- Upload security documentation covering zip-slip, archive expansion, and isolated build requirements.
- Client-side preflight validation for ZIP and standalone HTML file selections.
- File size limits of 25 MB for ZIP archives and 2 MB for HTML documents.
- ZIP signature checks and basic complete-HTML-document checks.
- Unit tests covering upload file limits, extensions, and ZIP signatures.

### Changed
- GitHub URL parsing and inspection now use strict validation, request timeouts, and clearer error handling.
- CI runs the unit test suite before typechecking and building.
- Dashboard labels distinguish preview data from real deployments and usage.

### Notes
- Upload preflight is not file transfer or deployment. Object storage, per-user authentication, build execution and hosting-provider integration remain future work.
- Public GitHub repository selection remains a preview-only integration; OAuth, private repositories, and deployment execution are not connected yet.
