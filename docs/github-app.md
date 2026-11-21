# GitHub App installation foundation

DEPLO includes an account-bound GitHub App installation flow for the future private-repository webhook worker.

## GitHub App configuration

Create a GitHub App with:
- Repository permissions: **Contents: Read-only**, **Metadata: Read-only**.
- Subscribe to **Push** events.
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

Apply migration `0004_github_app_installations.sql`. The installation mapping stores the DEPLO account ID, GitHub installation ID, and installation account label. It does not store access tokens. Installation tokens are minted on demand using a short-lived RS256 app JWT and request only Contents and Metadata read permissions.

## Current scope

This milestone provides the secure installation callback, account binding, database schema, and token-minting helper. The automatic deployment worker has not yet been switched to installation tokens; private-repository unattended deployment is not active until that worker integration is merged and configured. Existing private manual deployment continues to use the signed-in OAuth flow.
