# DEPLO

> Bring your code. We'll handle the rest.

DEPLO is a developer-focused deployment platform concept. It aims to make shipping websites and applications simple through GitHub imports, ZIP uploads, and standalone HTML uploads.

## Project status

Early development. Public GitHub repository inspection and an authenticated local upload-storage endpoint are implemented. Per-user authentication, object storage, ZIP extraction, builds, deployment providers, and production infrastructure are not yet configured.

## Current GitHub import preview

The dashboard can inspect **public GitHub repositories** by URL, retrieve repository metadata and available branches, and add a selected branch to the in-browser dashboard preview.

This is an early integration milestone, not a production deployment pipeline:
- Private repositories and GitHub OAuth are not connected yet.
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
curl -X POST http://localhost:3000/api/uploads \\
  -H "Authorization: Bearer $DEPLO_UPLOAD_TOKEN" \\
  -F "kind=html" \\
  -F "file=@index.html"
```

This local filesystem adapter requires persistent disk and a Node.js runtime. It is not suitable for ephemeral serverless filesystems. The upload token is a shared server-side gate, not per-user authentication; do not expose it in browser code. Project ownership, account authentication, quotas, cleanup, object storage, ZIP parsing/extraction, builds, and deployments are not implemented yet.

## Upload preflight (early milestone)

The browser checks selected ZIP and standalone HTML files before upload:
- ZIP archives: `.zip` extension, ZIP signature, and a 25 MB maximum.
- HTML documents: `.html`/`.htm` extension, complete-document marker, and a 2 MB maximum.
- Invalid selections are rejected with an inline message.

Client-side checks improve feedback, but the server independently validates every upload. ZIP contents still require archive inspection and safe extraction before production use.

## Upload archive security

The archive safety policy defines path traversal checks and conservative limits for archive entries, expanded size, and compression ratio. See [Upload Security](docs/UPLOAD_SECURITY.md). These checks are groundwork only; ZIP parsing, extraction, build execution, and deployment are not implemented yet.

## Planned capabilities

- GitHub repository import
- ZIP project upload
- Standalone `index.html` upload
- Build and deployment history
- Live build logs
- Project settings and environment variables
- Custom domains and HTTPS (later phase)

## Local development

Requirements: Node.js 20+ and npm.

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
