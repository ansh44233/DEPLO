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

## Sign in with the GitHub App

The same GitHub App can handle "Sign in with GitHub", which gives DEPLO far less access than a classic OAuth App:

| | GitHub App sign-in | Classic OAuth App |
| --- | --- | --- |
| What the user's token can do | Only the App's permissions (Contents and Metadata: read) | `repo` scope: read **and write** every repository the user can reach |
| Which repositories | Only those where the App is installed | All of them |
| Token lifetime | 8 hours, refreshed automatically | Until revoked |

To use it:
1. In the App's settings, set **Callback URL** to `https://YOUR_DEPLO_HOST/api/auth/github/callback` and keep **Expire user authorization tokens** turned on.
2. Generate a **client secret** for the App.
3. Set `GITHUB_CLIENT_ID` to the App's client ID (it starts with `Iv`) and `GITHUB_CLIENT_SECRET` to that secret. DEPLO detects the App from the client ID and stops asking for the `repo` scope. `DEPLO_GITHUB_SIGN_IN=app` forces it.

Users who signed in with the old OAuth App keep working until their session ends (at most 7 days); the next sign-in uses the App. The repository picker then lists only repositories where the App is installed, and links to GitHub to add more. Access tokens are refreshed in middleware a few minutes before they expire; if the refresh token has expired too, the user is asked to sign in again.

## Pull request previews

When a pull request is opened, reopened or gets new commits, DEPLO builds its head commit for every project that deploys the PR's base branch. Each preview is published to the Cloudflare Pages branch `pr-<number>` and served at `https://pr-<number>.<project>.pages.dev`; the production URL never changes. Previews appear in the project's deployment history as **preview** deployments. Pull requests from forks are ignored, because their code is untrusted and would otherwise be fetched with the installation token. Apply migration `0014_pull_request_preview_deliveries.sql` before subscribing to **Pull request** events.

### Security notes for previews

- **Who can trigger a build.** Any pull request from a branch in the same repository, so anyone with write access can run build scripts in the sandbox. Treat write access to a deployed repository accordingly, and keep branch protection on the production branch.
- **Forks are never built.** A pull request whose head is not provably the base repository (different name or different repository ID) is ignored.
- **The GitHub token is limited to one repository.** DEPLO mints each installation token for only the repository being built, with read-only Contents and Metadata. A build script that leaks it cannot read your other repositories.
- **Previews get no saved build variables.** Per-project environment variables may be secrets, so only production (push) builds receive them. A preview of a project that needs variables to build will fail until preview-specific variables exist.
- **Previews are public.** `pr-<number>.<project>.pages.dev` is reachable by anyone who has the URL, like production, including for private repositories. Do not put unreleased secrets or confidential content in a pull request of a deployed repository.
- **Previews stay until the project is deleted.** Closing a pull request does not remove its preview, and an older queued commit that is retried after a newer one can briefly replace the newer preview.

Installation tokens are minted on demand using a short-lived RS256 app JWT and request only Contents and Metadata read permissions. Tokens are never stored. Automatic webhook deployments use the installation belonging to each DEPLO account and can access private repositories selected in that installation. Accounts without an installation mapping retain public-repository fallback behavior.

## Deployment scope

DEPLO publishes static sites with a root `index.html`. It does not execute repository scripts or arbitrary framework build commands. Private repository webhook deployments require the GitHub App to be installed and the repository selected. The webhook worker is invoked by the configured trusted scheduler.
