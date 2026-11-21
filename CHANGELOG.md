# DEPLO

> Bring your code. We'll handle the rest.

DEPLO is a developer-focused deployment platform concept. It aims to make shipping websites and applications simple through GitHub imports, ZIP uploads, and standalone HTML uploads.

## Project status

Early development. The current repository is being scaffolded; deployment providers, authentication, storage, and production infrastructure are not yet configured.

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

## Documentation

- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security Policy](SECURITY.md)

## License

MIT. See [LICENSE](LICENSE).


## Unreleased

### Added
- Public GitHub repository inspection by repository URL.
- Repository metadata and branch discovery through a server-side API route.
- Branch selection and an honest preview-only workspace entry.
- Dashboard states that distinguish a connected repository from a deployed project.

### Notes
- GitHub OAuth, private repository access, persistent project storage, build execution, and live deployments remain future work.


## Unreleased

### Security
- Strictly validate public GitHub repository URLs before making outbound requests.
- Reject non-HTTPS, lookalike hosts, credentials, custom ports, query strings, fragments, encoded path separators, and non-root paths.
- Add an eight-second timeout to GitHub API requests and explicit timeout handling.

### Tests and CI
- Add unit tests for accepted and rejected GitHub repository URL formats.
- Run the test suite in GitHub Actions before typechecking and building.
