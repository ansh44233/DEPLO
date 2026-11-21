# Changelog

All notable changes to DEPLO are documented here.

## Unreleased

### Added
- Supabase Postgres project metadata storage with account-scoped list/create API routes and owner IDs derived only from verified GitHub sessions.
- Dashboard project list loads saved account projects and persists imported public GitHub repository metadata when signed in.
- Initial SQL migration with per-account slug uniqueness and row-level security enabled.
- Tests for owner filtering, server-only service-role headers, missing configuration, and duplicate slugs.
- GitHub OAuth sign-in with short-lived state validation and signed HttpOnly sessions.
- Session inspection and origin-checked sign-out endpoints, plus dashboard sign-in controls.
- Documentation clarifying that account identity is not yet project ownership or private-repository authorization.
- Read-only Cloudflare Pages deployment history API with sanitized deployment records and no-store responses.
- Dashboard provider-readiness indicator connected to the no-store deployment status endpoint.
- Public GitHub repository deployment endpoint: downloads a selected branch, safely extracts its archive, validates static assets, and publishes through Cloudflare Pages.
- Input validation tests for Git branch names and deployment slugs.
- Cloudflare Pages static deployment adapter using a pinned Wrangler CLI and server-side credentials.
- Authenticated deployment endpoint for ZIP and standalone HTML uploads, returning the provider's live Pages URL.
- Static asset checks for file count, per-file/total size, symlinks, and common private configuration paths.
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
- A no-store deployment readiness endpoint that reports missing Cloudflare configuration without exposing secret values.

### Changed
- GitHub URL parsing and inspection now use strict validation, request timeouts, and clearer error handling.
- CI runs the unit test suite before typechecking and building.
- Dashboard labels distinguish preview data from real deployments and usage.

### Notes
- Static deployment endpoints require Cloudflare Pages credentials and a configured Pages project on the server; readiness checks verify presence and format, not provider-side validity.
- The GitHub integration currently supports public repositories with a root `index.html`; private repository OAuth, framework build execution, per-user project ownership, and automatic push redeploys are not connected.
- Uploads use local filesystem storage and a shared server-side bearer token; production multi-user hosting still needs durable object storage, account-level authorization, quotas, cleanup, and isolated build infrastructure.
