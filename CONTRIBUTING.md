# Contributing to DEPLO

Thanks for your interest in contributing.

## Before you start

- Read the [Code of Conduct](CODE_OF_CONDUCT.md).
- Check existing issues and discussions before opening a new one.
- For significant changes, open an issue first to discuss the approach.

## Development setup

1. Install Node.js 20 or newer.
2. Clone the repository.
3. Install dependencies with `npm ci` (exactly the versions in `package-lock.json`).
4. Start the development server with `npm run dev`.
5. Before submitting, run `npm run lint`, `npm test`, `npm run typecheck` and `npm run build`; run `npx playwright install chromium` once, then `npm run test:e2e`.
6. Changed `native/blake3-wasm`? Run `npm run build:wasm` (needs `rustup target add wasm32-unknown-unknown`) and commit `lib/deploy/blake3.wasm`.

## Pull requests

- Keep pull requests focused and reasonably small.
- Include a clear description of the problem and solution.
- Add screenshots for user-interface changes when useful.
- Update documentation and `CHANGELOG.md` when behavior changes.
- Never commit credentials, tokens, private keys, or real environment files.
- Ensure checks pass before requesting review.

## Commit messages

Use concise messages such as `feat: add project import flow`,
`fix: correct mobile navigation`, or `docs: update setup instructions`.

## Reporting bugs

Include steps to reproduce, expected behavior, actual behavior, relevant
browser/runtime versions, and screenshots or logs with secrets removed.
