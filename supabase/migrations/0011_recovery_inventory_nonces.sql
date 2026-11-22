-- Durable one-time challenges for signed recovery inventory snapshots.
-- Nonces are scoped to a build job and can be consumed exactly once.
create table if not exists public.build_recovery_inventory_nonces (
  nonce uuid primary key,
  job_id uuid not null references public.build_jobs(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (consumed_at is null or consumed_at >= created_at)
);

create index if not exists build_recovery_inventory_nonce_expiry_idx
  on public.build_recovery_inventory_nonces (expires_at)
  where consumed_at is null;

alter table public.build_recovery_inventory_nonces enable row level security;
revoke all on public.build_recovery_inventory_nonces from public, anon, authenticated;
grant all on public.build_recovery_inventory_nonces to service_role;

-- The trusted supervisor creates a short-lived challenge before requesting
-- the host inventory. A nonce can never be re-issued for another job.
create or replace function public.issue_deplo_recovery_inventory_nonce(
  p_nonce uuid,
  p_job_id uuid,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_nonce is null or p_job_id is null or p_expires_at is null
     or p_expires_at <= now()
     or p_expires_at > now() + interval '2 minutes' then
    raise exception 'Invalid recovery inventory nonce';
  end if;

  insert into public.build_recovery_inventory_nonces (nonce, job_id, expires_at)
  values (p_nonce, p_job_id, p_expires_at)
  on conflict (nonce) do nothing;

  return found;
end;
$$;

-- Atomic single-use consume. Only a verified server-side caller should invoke
-- this after signature, freshness, job, and resource-identity checks pass.
create or replace function public.consume_deplo_recovery_inventory_nonce(
  p_nonce uuid,
  p_job_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_nonce is null or p_job_id is null then
    return false;
  end if;

  update public.build_recovery_inventory_nonces
     set consumed_at = now()
   where nonce = p_nonce
     and job_id = p_job_id
     and consumed_at is null
     and expires_at > now();

  return found;
end;
$$;

revoke all on function public.issue_deplo_recovery_inventory_nonce(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.consume_deplo_recovery_inventory_nonce(uuid, uuid) from public, anon, authenticated;
grant execute on function public.issue_deplo_recovery_inventory_nonce(uuid, uuid, timestamptz) to service_role;
grant execute on function public.consume_deplo_recovery_inventory_nonce(uuid, uuid) to service_role;

-- Expired/consumed rows can be pruned by a scheduled service-role maintenance task.
-- Do not add an automatic deletion policy that could race active verification.
