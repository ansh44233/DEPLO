-- Dependency cache for sandbox builds: one Vercel Sandbox snapshot per project.
-- The snapshot holds only node_modules (no source, .git or secrets); cache_key
-- is a SHA-256 of the project's dependency fields and lockfiles. Snapshots expire
-- on Vercel's side, so a stale row only means the next build installs from scratch.
create table if not exists public.project_build_caches (
  project_id uuid primary key references public.projects (id) on delete cascade,
  owner_github_id bigint not null,
  cache_key text not null,
  snapshot_id text not null,
  updated_at timestamptz not null default now(),
  constraint project_build_caches_key_format check (cache_key ~ '^[a-f0-9]{64}$'),
  constraint project_build_caches_snapshot_format check (snapshot_id ~ '^[A-Za-z0-9_-]{1,128}$')
);

create index if not exists project_build_caches_owner_idx
  on public.project_build_caches (owner_github_id, project_id);

alter table public.project_build_caches enable row level security;
revoke all on public.project_build_caches from anon, authenticated;
grant all on public.project_build_caches to service_role;
