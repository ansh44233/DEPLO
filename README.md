# DEPLO

> Bring your code. We'll handle the rest.

DEPLO is a developer-focused deployment platform concept. It aims to make shipping websites and applications simple through GitHub imports, ZIP uploads, and standalone HTML uploads.

## Project status

Early development. Public GitHub repository inspection, GitHub account sign-in, and an authenticated local upload-storage endpoint are implemented. Database-backed project ownership, account-scoped authorization, object storage, builds, and production infrastructure are not yet configured.

## Current GitHub import preview

The dashboard can inspect **public GitHub repositories** by URL, retrieve repository metadata and available branches, and add a selected branch to the in-browser dashboard preview.

This is an early integration milestone, not a production deployment pipeline:
- Private repository access is not connected yet. GitHub OAuth sign-in establishes account identity only; it does not yet grant private-repository access.
- The selected repository is held in client-side preview state and is not saved to an account database.
- Selecting a repository does not run a build or publish a live URL.
- GitHub's unauthenticated API rate limits apply.

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

The browser checks selected ZIP and standalone HTML files before upload:
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

## Deploy a public GitHub repository

DEPLO can download a selected branch from a **public** GitHub repository and publish it as a static Cloudflare Pages site.

```bash
curl -X POST "http://localhost:3000/api/github/deploy" \
  -H "Authorization: Bearer $DEPLO_UPLOAD_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"repositoryUrl":"https://github.com/owner/repository","branch":"main","projectSlug":"my-site"}'
```

The endpoint downloads the GitHub ZIP archive from GitHub's fixed API host, enforces a 25 MiB download limit, applies the same safe ZIP extraction policy as uploads, requires a root `index.html`, checks static asset limits and blocked secret/config paths, then deploys through the configured Cloudflare Pages project. It returns the deployment URL.

**Current scope:** public repositories and static HTML/CSS/JS only. Private repositories, framework build commands, per-user project ownership, and automatic redeployment on Git pushes are not yet supported. DEPLO does not execute repository scripts.

## Cloudflare Pages static deployment (early milestone)

The authenticated `POST /api/uploads/{uploadId}/deploy` endpoint can publish an uploaded ZIP or standalone HTML file as a static site through Wrangler.

Before using it:
1. Create a **Direct Upload** Cloudflare Pages project in your Cloudflare account. Set its name in `CLOUDFLARE_PAGES_PROJECT_NAME`.
2. Create a Cloudflare API token with Pages Write permission.
3. Configure `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, and `CLOUDFLARE_PAGES_PROJECT_NAME` on the server.
4. Keep `DEPLO_UPLOAD_TOKEN` private; do not put it in browser code.

Example request:

```bash
curl -X POST "http://localhost:3000/api/uploads/<upload-id>/deploy" \
  -H "Authorization: Bearer $DEPLO_UPLOAD_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"projectSlug":"my-website"}'
```

DEPLO deploys static files only; it does not run package scripts or arbitrary build commands. It requires a root `index.html`, blocks common secret/config paths, rejects symlinks, and enforces file-count and size limits. A project slug is mapped to a Pages preview branch (for example, `site-my-website`). The returned URL comes from Wrangler/Cloudflare.

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

The GitHub repository inspection endpoint only accepts canonical public GitHub repository URLs. It does not provide private repository access or deployment execution.

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

This is the persistence/API foundation. The dashboard project list is still a preview and is not yet connected to these endpoints. Deployment routes are also not yet scoped to project ownership; keep them behind the existing server-side token and do not expose that token to browsers.
