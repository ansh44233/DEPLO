# GitHub App installation

DEPLO supports account-bound GitHub App installations for automatic deployment of public and private static repositories.

## GitHub App configuration

Create a GitHub App with:
- Repository permissions: **Contents: Read-only**, **Metadata: Read-only**.
- Subscribe to **Push** and **Installation** events.
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

Installation tokens are minted on demand using a short-lived RS256 app JWT and request only Contents and Metadata read permissions. Tokens are never stored. Automatic webhook deployments use the installation belonging to each DEPLO account and can access private repositories selected in that installation. Accounts without an installation mapping retain public-repository fallback behavior.

## Deployment scope

DEPLO publishes static sites with a root `index.html`. It does not execute repository scripts or arbitrary framework build commands. Private repository webhook deployments require the GitHub App to be installed and the repository selected. The webhook worker is invoked by the configured trusted scheduler.
