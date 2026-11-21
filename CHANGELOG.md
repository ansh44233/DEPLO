# Changelog

All notable changes to DEPLO are documented here.

## Unreleased

### Added
- Signed GitHub push webhook receiver with raw-body HMAC verification, strict payload validation, bounded request size, and idempotent delivery inbox migration.
- Documented webhook setup and explicitly scoped the current endpoint to secure event ingestion; deployment worker is a subsequent milestone.
- Owner-verified project deletion now removes the matching isolated Cloudflare Pages site and deployment history before deleting DEPLO project metadata, with safe retry behavior and explicit dashboard confirmation.
- Tests for provider deletion authorization, idempotent missing-project handling, empty success responses, and fail-closed errors.
- Deterministic per-account Cloudflare Pages project provisioning with an isolated production branch for every account-owned site.
- Automatic creation and verification of each project's Cloudflare Pages target before static GitHub or ZIP/HTML publishing.
- Deployment history, logs, and rollback requests now resolve the isolated Pages project from the verified account owner and project slug.
- Owner-scoped Cloudflare Pages deployment log API with branch-membership checks, bounded/sanitized log output, and no-store responses.
- Dashboard deployment log viewer for account-owned projects.
- Owner-scoped Cloudflare production rollback endpoint with strict successful-production and project-branch checks.
- Tests for rollback request validation and deployment log retrieval/response validation.
- Private GitHub repository inspection and account-owned static deployment using the signed-in GitHub OAuth token.
- AES-256-GCM encryption helper for the GitHub token, held only in a Secure/HttpOnly/SameSite cookie and cleared on sign-out.
- Tests covering token encryption, nonce uniqueness, tamper detection, and invalid-key handling.
- Account-owned ZIP and standalone HTML upload deployment endpoint with signed-session ownership checks, safe archive extraction, static asset validation, Cloudflare publishing, and deployment URL persistence.
- Dashboard ZIP/HTML upload flow that creates or reuses an account project and publishes it after local preflight checks.
- Account-scoped GitHub project deployment endpoint that verifies project ownership from the signed-in GitHub session before publishing.
- Account-scoped Cloudflare Pages deployment history filtered to the saved project's deployment branch.
- Persist deployment URLs and update timestamps back to the owning project's database record.
- Tests covering project lookup and deployment updates constrained by both project ID and account owner ID.
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
- Account-owned GitHub, ZIP, and HTML deployment routes publish static sites with a root `index.html`; they do not execute framework build scripts. They require a valid GitHub session and configured Supabase/Cloudflare credentials. Automatic push redeploys remain unsupported. GitHub's classic `repo` OAuth scope is broad; replace it with a read-only GitHub App installation before production launch.
- Uploads use local filesystem storage and a shared server-side bearer token; production multi-user hosting still needs durable object storage, account-level authorization, quotas, cleanup, and isolated build infrastructure.
