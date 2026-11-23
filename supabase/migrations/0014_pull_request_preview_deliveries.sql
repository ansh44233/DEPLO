-- Pull request preview deployments.
-- A delivery with a pull_request_number came from a GitHub `pull_request` event:
-- `branch` holds the PR's base branch (used to match DEPLO projects) and
-- `commit_sha` holds the PR head commit. The worker deploys it to the
-- Cloudflare Pages branch `pr-<number>` and leaves production untouched.
alter table public.github_webhook_deliveries
  add column if not exists pull_request_number integer
    check (pull_request_number is null or pull_request_number between 1 and 999999999);

-- The existing claim function returns `setof github_webhook_deliveries`, so the
-- worker receives the new column without changing the function.
