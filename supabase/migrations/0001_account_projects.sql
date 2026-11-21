-- DEPLO account-owned projects.
-- The service-role key is server-only. Never expose it in browser code.
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_github_id bigint not null,
  name varchar(60) not null,
  slug varchar(58) not null,
  source_type text not null check (source_type in ('github', 'zip', 'html')),
  repository_url text,
  branch text,
  deployment_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_owner_slug_unique unique (owner_github_id, slug),
  constraint projects_source_fields_check check (
    (source_type = 'github' and repository_url is not null and branch is not null)
    or
    (source_type in ('zip', 'html') and repository_url is null and branch is null)
  ),
  constraint projects_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{0,57}$')
);

create index if not exists projects_owner_updated_idx
  on public.projects (owner_github_id, updated_at desc);

alter table public.projects enable row level security;

-- All application access is performed server-side with the Supabase service-role key.
-- No anon/authenticated policies are intentionally created.
revoke all on public.projects from anon, authenticated;
grant all on public.projects to service_role;
