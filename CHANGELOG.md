# Changelog

All notable changes to DEPLO are documented here.

## Unreleased

### Security
- "Sign in with GitHub" can use the GitHub App's client credentials instead of a classic OAuth App. DEPLO then asks for no scopes: the user's token can only read repositories where the App is installed (instead of `repo`, which allows reading and writing every repository), and it expires after 8 hours. Expiring tokens are refreshed in middleware, with concurrent requests sharing one refresh. The App is detected from an `Iv…` client ID; `DEPLO_GITHUB_SIGN_IN` overrides it. The repository picker explains that only repositories where the App is installed appear, with a link to add more.

### Security
- Dashboard builds no longer put the signed-in user's GitHub OAuth token in the build sandbox. Public repositories are cloned without a token, private ones with a repository-scoped, read-only GitHub App installation token, and otherwise the downloaded archive is copied in (with executable bits kept).
- Sign out ends the session on the server (migration `0016_revoked_sessions.sql`) and revokes the GitHub token at GitHub.
- `DEPLO_ALLOWED_GITHUB_USERS` restricts sign-in to named GitHub accounts; removing an account ends its sessions.
- Per-account deploy rate limit (`DEPLO_DEPLOYS_PER_HOUR`, default 30; migration `0017_deploy_rate_limits.sql`).
- Middleware adds a Content Security Policy, HSTS, `X-Frame-Options`, referrer and permissions policies to every response, and refuses cross-site state-changing API requests.

### Deployment
- Dashboard deploys resolve the branch to one commit first, so the archive, the build and the result always match, and the response reports `commitSha`.

### Performance
- Dependency cache for framework builds: after a successful build DEPLO snapshots the Vercel Sandbox with only `node_modules` kept, and the next build whose dependencies and lockfiles are unchanged starts from that snapshot and skips the install step. Monorepos are not cached, pull request previews read the cache but never write it, and a build that fails on the cache is retried once from a clean install. Requires migration `0015_project_build_caches.sql`; set `DEPLO_DISABLE_BUILD_CACHE=1` to turn it off.
- Cloudflare Pages uploads run four requests at a time over smaller buckets instead of one large request after another.
- Optional Rust BLAKE3 hasher compiled to WebAssembly (`native/blake3-wasm`, built with `npm run build:wasm` into `lib/deploy/blake3.wasm`). It base64-encodes and hashes each asset in one pass; the JavaScript implementation remains the fallback and CI checks that both produce identical keys.

### Added
- Per-project environment variables: encrypted with AES-256-GCM (per-project derived key), managed in a new Environment tab (add, edit, reveal, paste a .env), optional at import time, and passed to install/build steps. Values are redacted from build logs. Requires migration `0013_project_environment_variables.sql`.
- GitHub repository picker: signed-in users choose from their own repositories (including private ones) with search, instead of pasting a URL. "Deploy" imports and deploys in one step.
- ZIP uploads: a single wrapping folder is detected automatically, `__MACOSX` metadata is dropped, source ZIPs of Vite/React/CRA/static Next.js projects are built in Vercel Sandbox, and files over the host's request limit upload directly to a private Supabase Storage bucket through a one-time signed URL (up to 25 MB).
- New "ember" design: hairline tile grids, mono section labels, coral accent, ASCII-art hero and serif accent type.

### Added
- Framework builds: Vite, React, Create React App and static-export Next.js repositories are built in a Vercel Sandbox microVM (clone, install, build) and the output is published to Cloudflare Pages. Works for dashboard deploys and push-to-deploy.
- Safe tar extraction for build output (GNU long names, path confinement, size and file-count limits; links skipped).
- Dashboard: Ctrl/Cmd+K command menu, live thumbnails on project cards, deploy timer and status strip, build-log viewer with copy, Redeploy, and a dismissible open-source card.
- New README with architecture diagram, feature overview and one-click Vercel deploy; the previous README moved to docs/REFERENCE.md.

### Fixed
- Vite projects (which have a root index.html) were published unbuilt; they are now built first.
- Deploy errors returned as non-JSON (for example a gateway timeout) no longer show a parse error.
- `.env.example` now lists every variable the app reads, grouped by purpose; the unused `NEXT_PUBLIC_APP_URL` was removed.

### Added
- Vercel hosting support: `vercel.json` with daily cron backstops for the webhook and build workers, and a step-by-step guide in `docs/VERCEL.md`.
- Pure TypeScript BLAKE3 implementation for Cloudflare Pages asset keys, verified against published test vectors.
- Worker GET handlers for Vercel Cron (`CRON_SECRET`) that drain each queue within a time budget.
- Push webhooks and new build jobs now trigger their worker immediately after responding, using `after()`.
- `/api/deploy/status` reports the host's upload limit; the dashboard rejects oversized uploads before sending and explains HTTP 413 responses.
- Dashboard **Build jobs** panel for GitHub projects: queue a framework build for an exact commit (with a "Use latest" helper that reads the saved branch's head commit), see the runner and publication state of each job, cancel pending or processing jobs, and auto-refresh while builds are active.

### Changed
- Cloudflare Pages publishing now uses the Direct Upload API over HTTPS instead of spawning the Wrangler CLI. Identical files are uploaded once and assets Cloudflare already has are skipped. `wrangler` is no longer a dependency.
- Legacy shared-token `/api/uploads*` endpoints return 501 on Vercel, where local disk does not persist between requests.
- README now describes the connected build worker instead of stating that queued jobs never run.

### Added
- Asynchronous isolated build-runner transport with stable idempotency keys, bounded status polling, and strict terminal artifact metadata validation.
- Durable runner job ID persistence, atomic polling claims, retry scheduling, and a protected background queue processor endpoint.
- Runner success is recorded as artifact-ready only; deployment success is withheld until an independent artifact validation and publishing pipeline exists.
- Supabase migration 0008 for runner job tracking and polling state.
- Tests for atomic queue RPC integration, idempotent runner submission, poll scheduling, and artifact metadata persistence.

### Changed
- Framework build jobs now dispatch through the asynchronous runner protocol instead of requiring a long-lived API request.
- Runner transport documentation now specifies the worker scheduler contract and the artifact-ready boundary.

### Added
- Framework build-plan detection for Vite, React, Create React App, and Next.js using package metadata and lockfiles only; no project config modules, dependency installs, or user scripts are executed.
- Tests for framework classification, package-manager selection, static export detection, malformed manifests, and safe no-build behavior.

### Added
- Owner-scoped project rename API and dashboard settings control; display names can be updated without changing deployment slugs or hosted URLs.
- Tests for owner-filtered project renames and rejection of projects belonging to other accounts.
- Deployment history now includes validated source commit hashes from Cloudflare metadata, displayed as short commit references alongside deployment IDs.
- GitHub App installation foundation with signed-in account binding, short-lived state validation, app-installation verification, and server-only installation-token minting using read-only repository permissions.
- GitHub App installation migration, setup documentation, and dashboard entry point for connecting private-repository deployment access.
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
