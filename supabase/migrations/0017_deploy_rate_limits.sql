-- Per-account deploy rate limit. Every deploy runs a build on the operator's
-- Vercel Sandbox quota and publishes to the operator's Cloudflare account, so
-- one account cannot start more than a set number of deploys per window.
create table if not exists public.deploy_attempts (
  id bigint generated always as identity primary key,
  owner_github_id bigint not null,
  created_at timestamptz not null default now()
);

create index if not exists deploy_attempts_owner_time_idx
  on public.deploy_attempts (owner_github_id, created_at desc);

alter table public.deploy_attempts enable row level security;
revoke all on public.deploy_attempts from anon, authenticated;
grant all on public.deploy_attempts to service_role;

-- Atomically records an attempt if the account is under its limit.
-- Returns the number of seconds to wait (0 means the attempt was recorded).
create or replace function public.claim_deploy_slot(p_owner_github_id bigint, p_limit integer, p_window_seconds integer)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_window interval;
  v_count integer;
  v_oldest timestamptz;
begin
  if p_owner_github_id is null or p_owner_github_id <= 0 then
    raise exception 'invalid owner';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 10000 or p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'invalid limit';
  end if;
  v_window := make_interval(secs => p_window_seconds);

  -- Serialise attempts per account so two requests cannot both take the last slot.
  perform pg_advisory_xact_lock(hashtextextended('deplo:deploy:' || p_owner_github_id::text, 0));

  delete from public.deploy_attempts
   where owner_github_id = p_owner_github_id and created_at < now() - v_window;

  select count(*), min(created_at) into v_count, v_oldest
    from public.deploy_attempts
   where owner_github_id = p_owner_github_id;

  if v_count >= p_limit then
    return greatest(1, ceil(extract(epoch from (v_oldest + v_window - now())))::integer);
  end if;

  insert into public.deploy_attempts (owner_github_id) values (p_owner_github_id);
  return 0;
end;
$$;

revoke all on function public.claim_deploy_slot(bigint, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_deploy_slot(bigint, integer, integer) to service_role;
