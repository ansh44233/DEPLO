# GitHub push redeployment worker

DEPLO records verified GitHub push events in the private Supabase inbox. A separate worker processes one queued delivery per request and deploys the exact commit SHA to every matching account-owned project.

## Server configuration

Set these server-only variables:

- `DEPLO_GITHUB_WEBHOOK_SECRET`: the HMAC secret configured on the GitHub repository webhook (at least 32 characters).
- `DEPLO_WEBHOOK_WORKER_SECRET`: a separate random bearer secret (at least 32 characters) used to protect the worker endpoint.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` for private-repository auto-deploys.

Apply migration `0004_github_app_installations.sql` in addition to the webhook migrations.
- `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`.

Apply migrations `0001_account_projects.sql`, `0002_github_webhook_deliveries.sql`, and `0003_github_webhook_retries.sql`.

## Run the worker

Send a POST request to `/api/internal/github-webhooks/process` with:

```http
Authorization: Bearer <DEPLO_WEBHOOK_WORKER_SECRET>
```

Run this endpoint from a trusted scheduler (for example, once per minute). Each request claims one event through a Postgres function using row locks and `SKIP LOCKED`, so concurrent workers cannot claim the same delivery. A claim older than ten minutes can be recovered if a worker crashes.

## Retry behavior

Transient failures are retried automatically with exponential backoff: 30 seconds, 1, 2, 4, and 8 minutes, capped at one hour. After five failed attempts, the delivery is marked terminally failed and retains a safe error code. Successful and unmatched deliveries are marked deployed or ignored. Duplicate GitHub delivery IDs remain deduplicated by the inbox primary key.

## Current limitations

- The worker uses a read-only GitHub App installation token for each account that has connected the DEPLO GitHub App. This supports private and public repositories selected in that installation. Accounts without an installation mapping retain the public-repository unauthenticated fallback; private repositories require the App to be installed and the repository selected.
- Only static sites with a root `index.html` are published. Repository scripts and framework build commands are never executed.
- Configure the GitHub repository webhook to send **push** events to `/api/webhooks/github` using the same `DEPLO_GITHUB_WEBHOOK_SECRET`.
- No live Cloudflare deployment is implied by passing unit tests; provider credentials and a real test repository are required.
