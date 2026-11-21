-- Track GitHub App suspension so webhook deployments cannot use suspended installations.
alter table public.github_app_installations
  add column if not exists suspended_at timestamptz;
