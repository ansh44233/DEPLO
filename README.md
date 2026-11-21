# DEPLO

> Bring your code. We'll handle the rest.

DEPLO is a developer-focused deployment platform concept. It aims to make shipping websites and applications simple through GitHub imports, ZIP uploads, and standalone HTML uploads.

## Project status

Early development. GitHub sign-in, encrypted private-repository access, account-owned projects, static GitHub/ZIP/HTML publishing, provider deployment history, webhook retries, and GitHub App installation foundations are implemented. Cloudflare and Supabase credentials must still be configured and verified before live use.

## Current GitHub import preview

The dashboard can inspect public repositories and private repositories accessible to the signed-in GitHub account, retrieve repository metadata and branches, and save selected branches as account-owned projects.

This is an early integration milestone, not a production deployment pipeline:
- Private repository inspection and static deployment are supported after GitHub sign-in, provided the user approves the requested `repo` OAuth scope.
- When signed in and Supabase is configured, the selected repository is saved as account-owned project metadata. Without sign-in or database configuration, it remains a temporary browser preview.
- Saving a repository does not immediately publish a live URL; use the project deployment action after saving.
- Authenticated GitHub API requests are used when a signed-in token is available; otherwise public API limits apply.

The inspection endpoint is `GET /api/github/repository?url=<public-repository-url>`.

## Server-side upload endpoint (early milestone)

An authenticated `POST /api/uploads` endpoint accepts multipart form uploads and stores validated files in a private local directory on a persistent Node.js host.

- Set `DEPLO_UPLOAD_TOKEN` to a random secret of at least 32 characters.
- Optionally set `DEPLO_UPLOAD_DIR` to a private persistent directory outside the public web root.
- Send `Authorization: Bearer <token>` and multipart fields `kind` (`zip` or `html`) and `file`.
- ZIP files are limited to 25 MB and checked for a ZIP signature; HTML files are limited to 2 MB and checked for an HTML document marker.
- The endpoint returns a random upload ID; uploaded bytes are never served publicly by this route.

Example:

```bash
curl -X POST http://localhost:3000/api/uploads \
  -H "Authorization: Bearer $DEPLO_UPLOAD_TOKEN" \
  -F "kind=html" \
  -F "file=@index.html"
```

This local filesystem adapter requires persistent disk and a Node.js runtime. It is not suitable for ephemeral serverless filesystems. The upload token is a shared server-side gate, not per-user authentication; do not expose it in browser code. Project ownership, account authentication, quotas, cleanup, object storage, build execution, and deployments are not implemented yet.

## Upload preflight (early milestone)

The browser checks selected ZIP and standalone HTML files before upload, then signed-in users can publish them through the account-owned upload endpoint:
- ZIP archives: `.zip` extension, ZIP signature, and a 25 MB maximum.
- HTML documents: `.html`/`.htm` extension, complete-document marker, and a 2 MB maximum.
- Invalid selections are rejected with an inline message.

Client-side checks improve feedback, but the server independently validates every upload. ZIP contents are stored privately and can be extracted through an authenticated endpoint with path, entry-count, expanded-size, compression-ratio, and symlink checks. Extraction output remains private; it is not built or deployed.

## ZIP extraction endpoint

After uploading a ZIP and receiving its `uploadId`, extract it into a private per-upload directory:

```bash
curl -X POST "http://localhost:3000/api/uploads/<upload-id>/extract" \\
  -H "Authorization: Bearer $DEPLO_UPLOAD_TOKEN"
```

The endpoint rejects unsafe paths, duplicate paths, symbolic links and special files, oversized archives, and excessive compression ratios. It streams entries to disk and enforces the actual expanded-byte limit. Extracted files are not publicly served and are not executed.

## Deploy a GitHub repository

DEPLO's account-owned deployment flow can download a selected branch from a public or authorized private GitHub repository and publish it as a static Cloudflare Pages site. The legacy shared-token endpoint shown below remains public-repository-only.

```bash
curl -X POST "http://localhost:3000/api/github/deploy" \
  -H "Authorization: Bearer $DEPLO_UPLOAD_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"repositoryUrl":"https://github.com/owner/repository","branch":"main","projectSlug":"my-site"}'
```

The endpoint downloads the GitHub ZIP archive from GitHub's fixed API host, enforces a 25 MiB download limit, applies the same safe ZIP extraction policy as uploads, requires a root `index.html`, checks static asset limits and blocked secret/config paths, then deploys through the configured Cloudflare Pages project. It returns the deployment URL.

**Current scope:** public and authenticated private repositories, with static HTML/CSS/JS only. Framework build commands and automatic redeployment on Git pushes are not yet supported. Account-owned deployments require a valid GitHub session and configured Supabase/Cloudflare credentials. DEPLO does not execute repository scripts.

## Private GitHub repository access

GitHub sign-in requests the `read:user repo` OAuth scopes. After consent:

- DEPLO encrypts the GitHub access token using AES-256-GCM and stores only the encrypted value in a Secure/HttpOnly/SameSite cookie. The raw token is never returned to browser JavaScript or saved in the projects database.
- Repository metadata and branch inspection use the signed-in token, allowing private repositories visible to that GitHub account to be imported.
- Account-owned GitHub deployment uses the same server-decrypted token to download the saved repository branch archive.
- Signing out clears both the DEPLO session and encrypted GitHub-token cookies. Both cookies expire after seven days; users must sign in again after expiry.
- Configure `GITHUB_TOKEN_ENCRYPTION_KEY` as a separate random server-only secret of at least 32 characters. Do not use a `NEXT_PUBLIC_` variable.

**OAuth permission note:** GitHub's classic `repo` scope is broad and includes write access to private repositories. DEPLO currently uses it only for repository reads, but the granted token has broader permissions than the app needs. For a production launch, replace this with a GitHub App installation flow using read-only Contents and Metadata permissions. Users can revoke the OAuth app's access from GitHub Settings at any time.

This milestone still deploys static sites with a root `index.html` only. It does not execute package scripts or framework builds.

## Account-owned ZIP and HTML uploads

Signed-in users can upload a ZIP archive or a standalone HTML document directly to an account-owned project:

- The dashboard validates the selected file locally, creates or reuses a matching account project, and sends the file to `POST /api/projects/{projectId}/upload`.
- The server verifies the signed GitHub session and confirms the project belongs to that account before accepting the upload.
- ZIP archives are safely extracted into a temporary private directory. HTML uploads are written as the site's root `index.html`.
- Both paths require a root `index.html`, enforce static asset limits and blocked-path checks, provision a dedicated Cloudflare Pages project for the account-owned project, deploy to its `site-{project-slug}` production branch, and save the resulting URL to the project record.
- ZIP uploads are limited to 25 MiB; standalone HTML uploads are limited to 2 MiB. Temporary files are removed after the deployment attempt.

This is a static publishing flow, not a build system. It does not run user-provided scripts or framework build commands. It requires the signed-in session, Supabase project storage, and Cloudflare Pages credentials to be configured on the server.


## Deployment history, logs, and rollback

- `GET /api/deploy/history?projectId={projectId}` returns the latest Cloudflare Pages deployments for the account-owned project's dedicated branch.
- `GET /api/projects/{projectId}/deployments/{deploymentId}/logs` verifies project ownership and deployment-branch membership before retrieving provider logs. The response is no-store and capped to the latest 300 sanitized log lines.
- The dashboard provides a deployment-log viewer for each listed deployment.
- `POST /api/projects/{projectId}/deployments/{deploymentId}/rollback` is owner-scoped and only permits successful **production** deployments belonging to the project.

Cloudflare only rolls back successful production deployments. DEPLO now provisions a separate Pages project for each account-owned project and configures `site-{project-slug}` as that Pages project's production branch. This makes successful deployments eligible for the guarded rollback endpoint. Existing projects are provisioned on their next deployment; deployments from the former shared Pages project are not automatically migrated.

## Account-owned GitHub project deployments

When a user is signed in and Supabase plus Cloudflare Pages are configured, DEPLO can deploy a saved public GitHub project through its account-owned project record:

- `POST /api/projects/{projectId}/deploy` verifies the signed GitHub session, looks up the project using both its UUID and the session's GitHub account ID, downloads the saved public repository branch, safely extracts it, checks static assets, and publishes it to the configured Cloudflare Pages project.
- Each account-owned project gets a dedicated Cloudflare Pages project, with `site-{project-slug}` configured as its production branch. Project names are deterministically derived from the GitHub account ID and project slug to avoid cross-account name collisions.
- After a successful publish, DEPLO saves the deployment URL and update timestamp to that same account-owned project record.
- `GET /api/deploy/history?projectId={projectId}` verifies ownership before returning Cloudflare deployment history for that project's Pages branch.

Account-owned deployment endpoints support public and authorized private GitHub repositories with a root `index.html` only. They do not execute repository scripts or build framework applications. Git push auto-deploys and deployment cancellation are not included. The shared upload-token endpoints remain separate legacy upload flows and are not substitutes for account-owned authorization.

## Cloudflare Pages static deployment (early milestone)

The authenticated `POST /api/uploads/{uploadId}/deploy` endpoint can publish an uploaded ZIP or standalone HTML file as a static site through Wrangler.

Before using it:
1. Create a Cloudflare API token with **Pages Write** permission.
2. Configure `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` on the server. DEPLO automatically creates an isolated Pages project for each account-owned site and sets that site's dedicated branch as production.
3. `CLOUDFLARE_PAGES_PROJECT_NAME` is optional and is used only by legacy shared-token deployment endpoints.
4. Keep `DEPLO_UPLOAD_TOKEN` private; do not put it in browser code.

Example request:

```bash
curl -X POST "http://localhost:3000/api/uploads/<upload-id>/deploy" \
  -H "Authorization: Bearer $DEPLO_UPLOAD_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"projectSlug":"my-website"}'
```

DEPLO deploys static files only; it does not run package scripts or arbitrary build commands. It requires a root `index.html`, blocks common secret/config paths, rejects symlinks, and enforces file-count and size limits. A project slug is mapped to a production branch (for example, `site-my-website`) inside that project's isolated Cloudflare Pages project. The returned URL comes from Wrangler/Cloudflare.

This integration requires a configured Cloudflare account and a pre-created Pages project. No live provider deployment has been performed from this repository yet. Per-user accounts, project ownership, usage billing, cleanup, build execution, GitHub private-repository OAuth, and custom domains remain future work.

## Upload archive security

The archive safety policy defines path traversal checks and conservative limits for archive entries, expanded size, and compression ratio. See [Upload Security](docs/UPLOAD_SECURITY.md). These checks are groundwork for the extraction pipeline. Build execution and deployment are not implemented yet.

## Planned capabilities

- GitHub repository import
- ZIP project upload
- Standalone `index.html` upload
- Build and deployment history
- Live build logs
- Project settings and environment variables
- Custom domains and HTTPS (later phase)

## Local development

Requirements: Node.js 22.12+ and npm.

```bash
npm install
npm run dev
```

Open http://localhost:3000.

Run the automated test suite with:

```bash
npm test
```

The GitHub repository inspection endpoint accepts canonical GitHub repository URLs. Private repository access requires a signed-in session and the approved GitHub OAuth permission. Account-owned deployment requires Supabase and Cloudflare configuration.

## Documentation

- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security Policy](SECURITY.md)

## License

MIT. See [LICENSE](LICENSE).


## Deployment readiness

The unauthenticated `GET /api/deploy/status` endpoint reports whether the server has the Cloudflare Pages settings and upload authentication required for deployment. It returns configuration booleans and missing setting names only; secret values are never returned. The response is marked `Cache-Control: no-store`.

A `ready: true` response confirms that required environment variables are present and syntactically valid. It does not verify that the Cloudflare token is accepted by Cloudflare or that the Pages project exists.


## GitHub sign-in (identity foundation)

DEPLO includes a server-side GitHub OAuth sign-in flow:
- OAuth state is generated per attempt, stored in a short-lived HttpOnly cookie, and checked before the callback is accepted.
- The callback exchanges the authorization code server-side and retrieves the GitHub profile.
- A seven-day HMAC-signed session cookie is HttpOnly, SameSite=Lax, and Secure in production.
- Only the minimal GitHub profile is included in the session. The OAuth access token is not stored in the cookie or persisted by this flow.
- `GET /api/auth/session` returns the current signed-in profile; `POST /api/auth/logout` clears the session after checking the request origin.

Configure a GitHub OAuth App with callback URL `https://YOUR_DEPLO_HOST/api/auth/github/callback`, then set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `DEPLO_SESSION_SECRET` (a separate random secret of at least 32 characters), and `DEPLO_BASE_URL` on the server. Never expose these values through `NEXT_PUBLIC_` variables.

**Important scope limit:** this is account identity only. It does not yet provide a database, per-user project ownership, private-repository access, encrypted OAuth-token storage, or account-scoped deployment authorization. Existing deployment endpoints still use the server-side shared upload token and must not be called directly from browser code. Configure a persistent database and ownership checks before treating DEPLO as a multi-user production service.


## Account-owned project storage (API foundation)

DEPLO can store project metadata in Supabase Postgres and scope project list/create operations to the GitHub account in the signed session:
- `GET /api/projects` lists only rows whose `owner_github_id` matches the verified session.
- `POST /api/projects` creates a project using the session's GitHub user ID; the owner ID is never accepted from the request body.
- Project slugs are unique per account. GitHub source URLs and branch names are validated before storage.
- The service-role key is used only on the server. The projects table has RLS enabled and no anonymous/authenticated policies.

To configure it, create a Supabase project, run [`supabase/migrations/0001_account_projects.sql`](supabase/migrations/0001_account_projects.sql) in the SQL editor, and set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` on the server. Never expose the service-role key through a `NEXT_PUBLIC_` variable.

This is the persistence/API foundation. When signed in, the dashboard loads account-owned projects and saves imported repository metadata through these endpoints. Deployment routes are still not scoped to project ownership; keep them behind the existing server-side token and do not expose that token to browsers.


## Project and hosted-site deletion

Deleting an account-owned project verifies the signed GitHub session and project ownership, derives the isolated Cloudflare Pages project name from that owner and project slug, and removes the hosted Pages project before deleting the DEPLO database record. This also removes the site's deployments and provider history. The dashboard displays a destructive confirmation before submitting the request.

If Cloudflare deletion fails, DEPLO keeps the database project record so the owner can retry. If Cloudflare has already removed the site but the database deletion fails, retrying is safe because a missing Pages project is treated as already removed. Projects that were never deployed do not require a Cloudflare cleanup request.


## GitHub push webhook inbox

DEPLO exposes `POST /api/webhooks/github` for GitHub `push` events. Configure a repository webhook with:
- Payload URL: `https://YOUR_DEPLO_HOST/api/webhooks/github`
- Content type: `application/json`
- Secret: the server-only `DEPLO_GITHUB_WEBHOOK_SECRET` value (at least 32 characters)
- Event: **Just the push event**

Apply `supabase/migrations/0002_github_webhook_deliveries.sql` before enabling the endpoint. The receiver validates GitHub's SHA-256 HMAC signature against the raw request body, bounds payload size, validates repository/branch/commit fields, ignores branch deletions, and stores each delivery ID under a unique constraint so GitHub retries are idempotent.

Required server environment:
- `DEPLO_GITHUB_WEBHOOK_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

**Current scope:** this endpoint securely records push events in the private database inbox and returns `202 Accepted`. It does not yet build or deploy a site. A separately authenticated queue worker and project-to-repository matching are required for automatic redeployment; do not interpret `queued: true` as a completed deployment.


## GitHub App installation foundation

DEPLO includes an account-bound GitHub App installation flow and server-side installation-token minting foundation. Configure the app with Contents and Metadata read-only permissions, a setup URL at `/api/auth/github/install/callback`, and the push webhook URL at `/api/webhooks/github`. Apply migration `0004_github_app_installations.sql`. See [GitHub App setup](docs/github-app.md). Private-repository unattended webhook deployment is not active until the worker is integrated with installation tokens.
