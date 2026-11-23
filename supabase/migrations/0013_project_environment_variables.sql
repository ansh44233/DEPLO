-- Per-project build environment variables.
-- Values are encrypted by the DEPLO server (AES-256-GCM) before they are stored;
-- the database never sees plaintext. Access is server-side only.
create table if not exists public.project_env_vars (
  project_id uuid not null references public.projects (id) on delete cascade,
  owner_github_id bigint not null,
  key text not null,
  value_encrypted text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, key),
  constraint project_env_vars_key_format check (key ~ '^[A-Za-z_][A-Za-z0-9_]{0,127}$'),
  constraint project_env_vars_value_size check (char_length(value_encrypted) <= 16384)
);

create index if not exists project_env_vars_owner_idx
  on public.project_env_vars (owner_github_id, project_id);

alter table public.project_env_vars enable row level security;
revoke all on public.project_env_vars from anon, authenticated;
grant all on public.project_env_vars to service_role;
