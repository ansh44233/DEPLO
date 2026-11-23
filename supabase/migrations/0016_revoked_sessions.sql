-- Sign-ins ended with "Sign out". Session cookies are signed and stateless, so
-- a copied cookie would otherwise stay valid until it expires (7 days). Each
-- session carries a random sign-in ID (sid); signing out records it here and
-- DEPLO refuses that session from then on. Rows are only needed until the
-- session would have expired anyway, and are pruned on each sign-out.
create table if not exists public.revoked_sessions (
  sid text primary key,
  owner_github_id bigint not null,
  expires_at timestamptz not null,
  revoked_at timestamptz not null default now(),
  constraint revoked_sessions_sid_format check (sid ~ '^[A-Za-z0-9_-]{22}$')
);

create index if not exists revoked_sessions_expires_idx on public.revoked_sessions (expires_at);

alter table public.revoked_sessions enable row level security;
revoke all on public.revoked_sessions from anon, authenticated;
grant all on public.revoked_sessions to service_role;
