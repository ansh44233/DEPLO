# Hosting DEPLO on Vercel

DEPLO's dashboard and API are a standard Next.js app and run on Vercel Functions (Node.js runtime). Sites that users deploy through DEPLO are still published to **Cloudflare Pages**; Vercel hosts DEPLO itself.

## What changed to make this work

| Concern | How DEPLO handles it on Vercel |
| --- | --- |
| Publishing to Cloudflare Pages | Uses the Pages **Direct Upload API** over HTTPS (`lib/deploy/cloudflare-pages.ts`). No Wrangler CLI or child process, so nothing extra has to fit in the function bundle. |
| Ephemeral filesystem | Every deploy path downloads, extracts and publishes inside one request under the OS temp directory. The legacy shared-token `/api/uploads*` endpoints, which keep files on disk between requests, return `501` on Vercel. |
| 4.5 MB request-body limit | `/api/deploy/status` reports `maxUploadBytes` (4 MB on Vercel) and the dashboard rejects larger ZIP/HTML files before sending them. Larger sites should be deployed from GitHub, where the archive is downloaded server-side and the 25 MiB limit still applies. |
| Background workers | Push webhooks and new build jobs trigger their worker right after the response (`after()` from `next/server`). While an owner has an active build open in the dashboard, each 10-second refresh advances the build worker by one step. `vercel.json` adds daily Vercel Cron runs as a backstop that drains each queue. |
| Long requests | Worker and deploy routes declare `maxDuration = 300`, which Vercel allows with Fluid compute (the default for new projects). |

**Framework builds** (Vite, React, Create React App, static-export Next.js) run in [Vercel Sandbox](https://vercel.com/docs/sandbox). On Vercel the SDK authenticates automatically with OIDC, so nothing extra is needed; the Hobby plan includes a free monthly quota (5 active-CPU hours). Deploy routes allow up to 300 seconds, which fits typical small and medium builds. The older self-hosted Firecracker runner in `services/build-runner` remains optional.

## 1. Prepare external services

1. **Supabase**: create a project and run every file in `supabase/migrations/` in order (see [migration runbook](SUPABASE_MIGRATION_RUNBOOK.md)).
2. **Cloudflare**: create an API token with **Cloudflare Pages: Edit** permission and note your account ID.
3. **GitHub OAuth App**: callback URL `https://<your-domain>/api/auth/github/callback`.
4. *(Optional)* **GitHub App** for private repositories and push deploys. See [GitHub App setup](github-app.md). Webhook URL: `https://<your-domain>/api/webhooks/github`.

## 2. Create the Vercel project

1. Import `ansh44233/DEPLO` in Vercel. The framework is detected as Next.js; keep the default build settings.
2. Choose the production domain you will use (for example `deplo.vercel.app`). The OAuth callback and `DEPLO_BASE_URL` must match it exactly.

## 3. Environment variables (Production)

Generate every secret separately, for example with `openssl rand -base64 48`.

| Variable | Required | Notes |
| --- | --- | --- |
| `DEPLO_BASE_URL` | yes | `https://<your-domain>`, no trailing path |
| `DEPLO_SESSION_SECRET` | yes | ≥ 32 characters |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | yes | OAuth App |
| `GITHUB_TOKEN_ENCRYPTION_KEY` | yes | ≥ 32 characters |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | yes | Server-only |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | yes | Pages Edit token |
| `CRON_SECRET` | yes | ≥ 32 characters. Vercel sends it to cron routes automatically |
| `DEPLO_GITHUB_WEBHOOK_SECRET` | for push deploys | Must match the GitHub webhook secret |
| `DEPLO_WEBHOOK_WORKER_SECRET` | for push deploys | ≥ 32 characters |
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY` | for private repos | Escaped `\n` in the key is supported |
| `DEPLO_BUILD_WORKER_SECRET`, `DEPLO_BUILD_RUNNER_URL`, `DEPLO_BUILD_RUNNER_TOKEN` | for framework builds | Requires a separately hosted runner |

Do not set `DEPLO_UPLOAD_DIR` or `DEPLO_UPLOAD_TOKEN` on Vercel; the legacy endpoints they configure are disabled there. Never prefix any of these with `NEXT_PUBLIC_`.

## 4. Deploy and verify

1. Deploy, then open `https://<your-domain>/api/deploy/status`. It should return `"ready": true` and `"maxUploadBytes": 4194304`.
2. Sign in with GitHub, import a repository that has a root `index.html`, and press **Deploy to Cloudflare Pages**. The project should show a `*.pages.dev` URL.
3. Upload a small ZIP from the dashboard to check the upload path.
4. If you configured webhooks, push to the saved branch and watch **GitHub push activity**.

## Cron frequency

`vercel.json` schedules each worker once a day, which every Vercel plan accepts. On a Pro plan you can raise the frequency (for example `*/5 * * * *` for the webhook worker) to retry failed deliveries sooner. Normal pushes and builds do not wait for cron; they are triggered immediately as described above.
