# Security Policy

## Supported Versions

DEPLO is in early development. Security fixes are applied to the latest
development version on the default branch.

## Reporting a Vulnerability

Please do not publish exploitable vulnerability details in a public issue.

Use GitHub's **Report a vulnerability** feature in the repository's
Security tab when private vulnerability reporting is enabled. If that feature
is unavailable, contact the repository owner privately through GitHub.

Include:
- A description of the issue and its potential impact.
- Steps to reproduce or a proof of concept that does not access other
  people's data.
- Affected commits, files, or versions, if known.

Please allow maintainers reasonable time to investigate and prepare a fix
before public disclosure.

## How DEPLO protects an instance

- **Builds never see user credentials.** Builds run the repository's own
  scripts inside a Vercel Sandbox microVM. A signed-in user's GitHub OAuth
  token stays on the server: public repositories are cloned without a token,
  private ones with a GitHub App installation token limited to that one
  repository (read-only, under an hour), and otherwise the archive DEPLO
  already downloaded is copied in. DEPLO's own secrets never enter the sandbox.
- **Least-privilege sign-in.** With the GitHub App's client credentials,
  "Sign in with GitHub" grants only the App's read-only permissions on
  repositories where it is installed, with tokens that expire after 8 hours
  and are refreshed server-side. A classic OAuth App needs the `repo` scope
  (read and write on every repository), so the App is recommended.
- **Sessions** are HMAC-signed, HttpOnly, SameSite=Lax cookies that expire
  after 7 days. Each sign-in has a random ID; **Sign out** records it
  (migration 0016) so a copied cookie stops working, and revokes the GitHub
  token at GitHub. Revocation lookups fail open if the database is down.
- **Who can sign in** is limited by `DEPLO_ALLOWED_GITHUB_USERS`. Removing an
  account also ends its existing sessions. Set it on every private instance.
- **Abuse limits:** each account may start `DEPLO_DEPLOYS_PER_HOUR` deploys
  per hour (default 30, migration 0017).
- **Cross-site requests:** state-changing API calls whose `Origin` is not
  DEPLO itself are refused (webhooks and workers use their own secrets).
- **Headers:** a Content Security Policy (`frame-ancestors 'none'`,
  `object-src 'none'`, `connect-src` limited to DEPLO and Supabase), HSTS,
  `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy and a
  restrictive permissions policy on every response.
- **Secrets at rest:** GitHub tokens and environment variables are encrypted
  with AES-256-GCM; environment variables use a key derived per project.
- **Uploads** are checked for zip-slip, symlinks, special files, archive bombs
  and secret-looking files before anything is published.
- **Webhooks** are verified with HMAC-SHA256; worker endpoints require bearer
  secrets.

## Security Notes

- Never commit secrets or production credentials.
- Treat uploaded archives and repository contents as untrusted input.
- Do not run customer-provided code without isolation, resource limits,
  and appropriate access controls.
- The current dashboard is a prototype and is not yet a production hosting
  service.
