# GitHub App installation

DEPLO supports account-bound GitHub App installations for automatic deployment of public and private static repositories.

## GitHub App configuration

Create a GitHub App with:
- Repository permissions: **Contents: Read-only**, **Metadata: Read-only**, **Pull requests: Read-only**.
- Subscribe to **Push**, **Pull request** and **Installation** events.
- Setup URL: `https://YOUR_DEPLO_HOST/api/auth/github/install/callback`.
- Webhook URL: `https://YOUR_DEPLO_HOST/api/webhooks/github`.
- Webhook secret: the same value configured as `DEPLO_GITHUB_WEBHOOK_SECRET`.

The setup URL is the GitHub App's installation return URL. DEPLO binds the callback to the signed-in account using a short-lived, HttpOnly state cookie and validates the installation against the app's signed JWT before storing the installation ID.

## DEPLO environment

Set these server-only variables:
- `GITHUB_APP_ID`
- `GITHUB_APP_SLUG`
- `GITHUB_APP_PRIVATE_KEY` (PEM contents; multiline or escaped newlines are supported)
- `DEPLO_BASE_URL`
- `DEPLO_SESSION_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Apply migrations `0004_github_app_installations.sql` and `0005_github_app_installation_lifecycle.sql`. DEPLO removes deleted installation records and disables deployments while an installation is suspended; unsuspending restores the connection.

## Pull request previews

When a pull request is opened, reopened or gets new commits, DEPLO builds its head commit for every project that deploys the PR's base branch. Each preview is published to the Cloudflare Pages branch `pr-<number>` and served at `https://pr-<number>.<project>.pages.dev`; the production URL never changes. Previews appear in the project's deployment history as **preview** deployments. Pull requests from forks are ignored, because their code is untrusted and would otherwise be fetched with the installation token. Apply migration `0013_pull_request_preview_deliveries.sql` before subscribing to **Pull request** events.

Installation tokens are minted on demand using a short-lived RS256 app JWT and request only Contents and Metadata read permissions. Tokens are never stored. Automatic webhook deployments use the installation belonging to each DEPLO account and can access private repositories selected in that installation. Accounts without an installation mapping retain public-repository fallback behavior.

## Deployment scope

DEPLO publishes static sites with a root `index.html`. It does not execute repository scripts or arbitrary framework build commands. Private repository webhook deployments require the GitHub App to be installed and the repository selected. The webhook worker is invoked by the configured trusted scheduler.
