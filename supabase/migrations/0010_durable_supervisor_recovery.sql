-- Durable, idempotent recovery ledger. This records plans/progress only; it does not perform host actions.
create table if not exists public.build_job_recovery_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.build_jobs(id) on delete cascade,
  recovery_key text not null check (recovery_key ~ '^[a-zA-Z0-9_-]{8,128}$'),
  journal_sequence integer not null check (journal_sequence >= 0),
  observed_state text not null check (observed_state in (
    'queued', 'preparing', 'starting', 'running', 'stopping',
    'succeeded', 'failed', 'cancelled'
  )),
  disposition text not null check (disposition in (
    'requeue_after_reconciliation', 'fail_after_reconciliation', 'preserve_terminal_state'
  )),
  actions jsonb not null check (
    jsonb_typeof(actions) = 'array'
    and jsonb_array_length(actions) between 1 and 5
  ),
  next_action_index integer not null default 0 check (next_action_index >= 0),
  status text not null default 'pending' check (status in ('pending', 'reconciling', 'completed', 'blocked')),
  claimed_at timestamptz,
  error_code text check (error_code is null or error_code ~ '^[a-z0-9_]{1,64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, recovery_key),
  check (next_action_index <= jsonb_array_length(actions)),
  check (status <> 'completed' or next_action_index = jsonb_array_length(actions)),
  check (status <> 'blocked' or error_code is not null)
);

create index if not exists build_job_recovery_ready_idx
  on public.build_job_recovery_attempts (created_at)
  where status = 'pending';
create index if not exists build_job_recovery_lease_idx
  on public.build_job_recovery_attempts (claimed_at)
  where status = 'reconciling';

alter table public.build_job_recovery_attempts enable row level security;
revoke all on public.build_job_recovery_attempts from public, anon, authenticated;
grant all on public.build_job_recovery_attempts to service_role;

-- Idempotently persist one immutable recovery plan. Reusing a key with a
-- different journal/plan is a conflict, never an overwrite.
create or replace function public.begin_deplo_build_recovery(
  p_job_id uuid,
  p_recovery_key text,
  p_journal_sequence integer,
  p_observed_state text,
  p_disposition text,
  p_actions jsonb
)
returns setof public.build_job_recovery_attempts
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.build_job_recovery_attempts;
  action_item jsonb;
begin
  if p_recovery_key is null or p_recovery_key !~ '^[a-zA-Z0-9_-]{8,128}

  for action_item in select value from jsonb_array_elements(p_actions)
  loop
    if jsonb_typeof(action_item) <> 'string'
       or action_item #>> '{}' not in (
         'inspect_owned_resources', 'stop_owned_vm_if_present',
         'remove_owned_workspace_if_present', 'requeue_job',
         'record_recovery_failure'
       ) then
      raise exception 'Invalid recovery action';
    end if;
  end loop;

  insert into public.build_job_recovery_attempts (
    job_id, recovery_key, journal_sequence, observed_state, disposition, actions
  ) values (
    p_job_id, p_recovery_key, p_journal_sequence, p_observed_state, p_disposition, p_actions
  ) on conflict (job_id, recovery_key) do nothing;

  select * into existing
    from public.build_job_recovery_attempts
   where job_id = p_job_id and recovery_key = p_recovery_key;

  if existing.journal_sequence <> p_journal_sequence
     or existing.observed_state <> p_observed_state
     or existing.disposition <> p_disposition
     or existing.actions <> p_actions then
    raise exception 'Recovery key conflicts with existing plan';
  end if;

  return next existing;
end;
$$;

-- Claims one pending attempt or reclaims a stale lease. This only leases a
-- ledger row; a trusted worker must still verify ownership before host actions.
create or replace function public.claim_next_deplo_build_recovery()
returns setof public.build_job_recovery_attempts
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate public.build_job_recovery_attempts;
begin
  select * into candidate
    from public.build_job_recovery_attempts
   where status = 'pending'
      or (status = 'reconciling' and claimed_at < now() - interval '2 minutes')
   order by created_at asc
   for update skip locked
   limit 1;

  if not found then return; end if;

  update public.build_job_recovery_attempts
     set status = 'reconciling', claimed_at = now(), updated_at = now()
   where id = candidate.id
   returning * into candidate;

  return next candidate;
end;
$$;

-- Advance exactly one action after the worker has independently completed it.
-- The database records the acknowledgement; it cannot verify the host action.
create or replace function public.advance_deplo_build_recovery(
  p_attempt_id uuid,
  p_expected_action_index integer,
  p_claimed_at timestamptz
)
returns setof public.build_job_recovery_attempts
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.build_job_recovery_attempts;
begin
  select * into current_row
    from public.build_job_recovery_attempts
   where id = p_attempt_id
   for update;

  if not found
     or current_row.status <> 'reconciling'
     or p_claimed_at is null
     or current_row.claimed_at is distinct from p_claimed_at
     or current_row.claimed_at < now() - interval '2 minutes'
     or current_row.next_action_index <> p_expected_action_index
     or p_expected_action_index >= jsonb_array_length(current_row.actions) then
    raise exception 'Recovery attempt is not claimable for this action';
  end if;

  update public.build_job_recovery_attempts
     set next_action_index = next_action_index + 1,
         status = case
           when next_action_index + 1 = jsonb_array_length(actions) then 'completed'
           else 'reconciling'
         end,
         claimed_at = case
           when next_action_index + 1 = jsonb_array_length(actions) then null
           else now()
         end,
         updated_at = now()
   where id = p_attempt_id
   returning * into current_row;

  return next current_row;
end;
$$;

create or replace function public.block_deplo_build_recovery(
  p_attempt_id uuid,
  p_claimed_at timestamptz,
  p_error_code text
)
returns setof public.build_job_recovery_attempts
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.build_job_recovery_attempts;
  safe_error text;
begin
  safe_error := case when p_error_code ~ '^[a-z0-9_]{1,64}$' then p_error_code else 'recovery_blocked' end;

  update public.build_job_recovery_attempts
     set status = 'blocked', error_code = safe_error, claimed_at = null, updated_at = now()
   where id = p_attempt_id
     and status = 'reconciling'
     and p_claimed_at is not null
     and claimed_at = p_claimed_at
     and claimed_at >= now() - interval '2 minutes'
   returning * into current_row;

  if not found then raise exception 'Recovery attempt is not active'; end if;
  return next current_row;
end;
$$;

revoke all on function public.begin_deplo_build_recovery(uuid, text, integer, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.claim_next_deplo_build_recovery() from public, anon, authenticated;
revoke all on function public.advance_deplo_build_recovery(uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.block_deplo_build_recovery(uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.begin_deplo_build_recovery(uuid, text, integer, text, text, jsonb) to service_role;
grant execute on function public.claim_next_deplo_build_recovery() to service_role;
grant execute on function public.advance_deplo_build_recovery(uuid, integer, timestamptz) to service_role;
grant execute on function public.block_deplo_build_recovery(uuid, timestamptz, text) to service_role;

     or p_journal_sequence is null or p_journal_sequence < 0
     or p_observed_state is null
     or p_observed_state not in ('queued', 'preparing', 'starting', 'running', 'stopping', 'succeeded', 'failed', 'cancelled')
     or p_disposition is null
     or p_disposition not in ('requeue_after_reconciliation', 'fail_after_reconciliation', 'preserve_terminal_state')
     or p_actions is null or jsonb_typeof(p_actions) <> 'array' then
    raise exception 'Invalid recovery plan';
  end if;

  if jsonb_array_length(p_actions) not between 1 and 5 then
    raise exception 'Invalid recovery plan';
  end if;

  for action_item in select value from jsonb_array_elements(p_actions)
  loop
    if jsonb_typeof(action_item) <> 'string'
       or action_item #>> '{}' not in (
         'inspect_owned_resources', 'stop_owned_vm_if_present',
         'remove_owned_workspace_if_present', 'requeue_job',
         'record_recovery_failure'
       ) then
      raise exception 'Invalid recovery action';
    end if;
  end loop;

  insert into public.build_job_recovery_attempts (
    job_id, recovery_key, journal_sequence, observed_state, disposition, actions
  ) values (
    p_job_id, p_recovery_key, p_journal_sequence, p_observed_state, p_disposition, p_actions
  ) on conflict (job_id, recovery_key) do nothing;

  select * into existing
    from public.build_job_recovery_attempts
   where job_id = p_job_id and recovery_key = p_recovery_key;

  if existing.journal_sequence <> p_journal_sequence
     or existing.observed_state <> p_observed_state
     or existing.disposition <> p_disposition
     or existing.actions <> p_actions then
    raise exception 'Recovery key conflicts with existing plan';
  end if;

  return next existing;
end;
$$;

-- Claims one pending attempt or reclaims a stale lease. This only leases a
-- ledger row; a trusted worker must still verify ownership before host actions.
create or replace function public.claim_next_deplo_build_recovery()
returns setof public.build_job_recovery_attempts
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate public.build_job_recovery_attempts;
begin
  select * into candidate
    from public.build_job_recovery_attempts
   where status = 'pending'
      or (status = 'reconciling' and claimed_at < now() - interval '2 minutes')
   order by created_at asc
   for update skip locked
   limit 1;

  if not found then return; end if;

  update public.build_job_recovery_attempts
     set status = 'reconciling', claimed_at = now(), updated_at = now()
   where id = candidate.id
   returning * into candidate;

  return next candidate;
end;
$$;

-- Advance exactly one action after the worker has independently completed it.
-- The database records the acknowledgement; it cannot verify the host action.
create or replace function public.advance_deplo_build_recovery(
  p_attempt_id uuid,
  p_expected_action_index integer
)
returns setof public.build_job_recovery_attempts
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.build_job_recovery_attempts;
begin
  select * into current_row
    from public.build_job_recovery_attempts
   where id = p_attempt_id
   for update;

  if not found
     or current_row.status <> 'reconciling'
     or current_row.claimed_at is null
     or current_row.claimed_at < now() - interval '2 minutes'
     or current_row.next_action_index <> p_expected_action_index
     or p_expected_action_index >= jsonb_array_length(current_row.actions) then
    raise exception 'Recovery attempt is not claimable for this action';
  end if;

  update public.build_job_recovery_attempts
     set next_action_index = next_action_index + 1,
         status = case
           when next_action_index + 1 = jsonb_array_length(actions) then 'completed'
           else 'reconciling'
         end,
         claimed_at = case
           when next_action_index + 1 = jsonb_array_length(actions) then null
           else now()
         end,
         updated_at = now()
   where id = p_attempt_id
   returning * into current_row;

  return next current_row;
end;
$$;

create or replace function public.block_deplo_build_recovery(
  p_attempt_id uuid,
  p_error_code text
)
returns setof public.build_job_recovery_attempts
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.build_job_recovery_attempts;
  safe_error text;
begin
  safe_error := case when p_error_code ~ '^[a-z0-9_]{1,64}$' then p_error_code else 'recovery_blocked' end;

  update public.build_job_recovery_attempts
     set status = 'blocked', error_code = safe_error, claimed_at = null, updated_at = now()
   where id = p_attempt_id and status = 'reconciling'
   returning * into current_row;

  if not found then raise exception 'Recovery attempt is not active'; end if;
  return next current_row;
end;
$$;

revoke all on function public.begin_deplo_build_recovery(uuid, text, integer, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.claim_next_deplo_build_recovery() from public, anon, authenticated;
revoke all on function public.advance_deplo_build_recovery(uuid, integer) from public, anon, authenticated;
revoke all on function public.block_deplo_build_recovery(uuid, text) from public, anon, authenticated;
grant execute on function public.begin_deplo_build_recovery(uuid, text, integer, text, text, jsonb) to service_role;
grant execute on function public.claim_next_deplo_build_recovery() to service_role;
grant execute on function public.advance_deplo_build_recovery(uuid, integer) to service_role;
grant execute on function public.block_deplo_build_recovery(uuid, text) to service_role;
