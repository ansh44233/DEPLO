# DEPLO

> Bring your code. We'll handle the rest.

DEPLO is a developer-focused deployment platform concept. It aims to make shipping websites and applications simple through GitHub imports, ZIP uploads, and standalone HTML uploads.

## Project status

Early development. The current repository is being scaffolded; deployment providers, authentication, storage, and production infrastructure are not yet configured.

## Current GitHub import preview

The dashboard can inspect **public GitHub repositories** by URL, retrieve repository metadata and available branches, and add a selected branch to the in-browser dashboard preview.

This is an early integration milestone, not a production deployment pipeline:
- Private repositories and GitHub OAuth are not connected yet.
- The selected repository is held in client-side preview state and is not saved to an account database.
- Selecting a repository does not run a build or publish a live URL.
- GitHub's unauthenticated API rate limits apply.

The inspection endpoint is `GET /api/github/repository?url=<public-repository-url>`.

## Upload preflight (early milestone)

The browser now checks selected ZIP and standalone HTML files before proceeding:
- ZIP archives: `.zip` extension, ZIP signature, and a 25 MB maximum.
- HTML documents: `.html`/`.htm` extension, complete-document marker, and a 2 MB maximum.
- Invalid selections are rejected with an inline message.

These are client-side preflight checks only. Files are not uploaded, stored, extracted, built, or deployed yet. ZIP contents still require server-side archive inspection and safe extraction before production use.

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
