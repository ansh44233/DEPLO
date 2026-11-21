-- Link a GitHub App installation to the DEPLO account that initiated setup.
-- Installation tokens are minted on demand and are never stored in this table.
create table if not exists public.github_app_installations (
  owner_github_id bigint primary key check (owner_github_id > 0),
  installation_id bigint not null unique check (installation_id > 0),
  account_login text not null check (length(account_login) between 1 and 100),
  account_type text not null check (account_type in ('User', 'Organization')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.github_app_installations enable row level security;
-- Service-role access only. No anon/authenticated policies.

create index if not exists github_app_installations_installation_idx
  on public.github_app_installations (installation_id);
