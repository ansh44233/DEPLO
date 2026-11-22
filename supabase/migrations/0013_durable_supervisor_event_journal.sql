-- Durable append-only supervisor event journal.
-- This records trusted supervisor assertions; it does not prove host isolation.
create table if not exists public.build_job_supervisor_journals (
  job_id uuid primary key references public.build_jobs(id) on delete cascade,
  sequence integer not null default 0 check (sequence >= 0),
  state text not null default 'queued' check (state in (
    'queued', 'preparing', 'starting', 'running', 'stopping',
    'succeeded', 'failed', 'cancelled'
  )),
  updated_at timestamptz not null default now()
);

create table if not exists public.build_job_supervisor_events (
  job_id uuid not null references public.build_job_supervisor_journals(job_id) on delete cascade,
  sequence integer not null check (sequence > 0),
  event_id text not null check (event_id ~ '^[a-zA-Z0-9_-]{8,128}$'),
  event text not null check (event in ('prepare', 'start', 'started', 'stop', 'succeed', 'fail', 'cancel')),
  occurred_at text not null check (occurred_at ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$'),
  from_state text not null check (from_state in (
    'queued', 'preparing', 'starting', 'running', 'stopping',
    'succeeded', 'failed', 'cancelled'
  )),
  to_state text not null check (to_state in (
    'queued', 'preparing', 'starting', 'running', 'stopping',
    'succeeded', 'failed', 'cancelled'
  )),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  created_at timestamptz not null default now(),
  primary key (job_id, sequence),
  unique (job_id, event_id)
);

create index if not exists build_job_supervisor_events_created_idx
  on public.build_job_supervisor_events (job_id, created_at);

alter table public.build_job_supervisor_journals enable row level security;
alter table public.build_job_supervisor_events enable row level security;
revoke all on public.build_job_supervisor_journals from public, anon, authenticated, service_role;
revoke all on public.build_job_supervisor_events from public, anon, authenticated, service_role;
grant select on public.build_job_supervisor_journals to service_role;
grant select on public.build_job_supervisor_events to service_role;

-- Atomic append with row-level serialization, expected-version checks and
-- idempotent event IDs. Only the service role may call this trusted boundary.
create or replace function public.append_deplo_supervisor_event(
  p_job_id uuid,
  p_event_id text,
  p_event text,
  p_occurred_at text,
  p_expected_sequence integer,
  p_expected_state text,
  p_next_state text,
  p_evidence jsonb default '{}'::jsonb
)
returns table (
  job_id uuid,
  sequence integer,
  event_id text,
  event text,
  occurred_at text,
  from_state text,
  to_state text,
  evidence jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  journal_row public.build_job_supervisor_journals;
  existing_event public.build_job_supervisor_events;
  evidence_key text;
  previous_time timestamptz;
  current_time_value timestamptz;
  transition_valid boolean := false;
begin
  if p_job_id is null
     or p_event_id is null or p_event_id !~ '^[a-zA-Z0-9_-]{8,128}$'
     or p_event not in ('prepare', 'start', 'started', 'stop', 'succeed', 'fail', 'cancel')
     or p_occurred_at is null
     or p_occurred_at !~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$'
     or p_expected_sequence is null or p_expected_sequence < 0
     or p_expected_state is null or p_next_state is null
     or p_evidence is null or jsonb_typeof(p_evidence) <> 'object' then
    raise exception 'Invalid supervisor event';
  end if;

  for evidence_key in select jsonb_object_keys(p_evidence)
  loop
    if evidence_key not in (
      'hostPreflightPassed', 'vmIsolationVerified', 'resourceLimitsVerified',
      'networkIsolationVerified', 'vmStopped', 'artifactValidated', 'cleanupComplete'
    ) or jsonb_typeof(p_evidence -> evidence_key) <> 'boolean' then
      raise exception 'Invalid supervisor evidence';
    end if;
  end loop;

  current_time_value := p_occurred_at::timestamptz;

  insert into public.build_job_supervisor_journals (job_id)
  values (p_job_id)
  on conflict (job_id) do nothing;

  select * into journal_row
    from public.build_job_supervisor_journals
   where build_job_supervisor_journals.job_id = p_job_id
   for update;

  select * into existing_event
    from public.build_job_supervisor_events
   where build_job_supervisor_events.job_id = p_job_id
     and build_job_supervisor_events.event_id = p_event_id;

  if found then
    if existing_event.event <> p_event
       or existing_event.occurred_at <> p_occurred_at
       or existing_event.from_state <> p_expected_state
       or existing_event.to_state <> p_next_state
       or existing_event.evidence <> p_evidence then
      raise exception 'Supervisor event ID conflict';
    end if;

    return query select existing_event.job_id, existing_event.sequence,
      existing_event.event_id, existing_event.event, existing_event.occurred_at,
      existing_event.from_state, existing_event.to_state, existing_event.evidence;
    return;
  end if;

  if journal_row.sequence <> p_expected_sequence
     or journal_row.state <> p_expected_state then
    raise exception 'Supervisor journal version conflict';
  end if;

  select occurred_at::timestamptz into previous_time
    from public.build_job_supervisor_events
   where build_job_supervisor_events.job_id = p_job_id
   order by sequence desc
   limit 1;

  if previous_time is not null and current_time_value <= previous_time then
    raise exception 'Supervisor event timestamp is not increasing';
  end if;

  if journal_row.state = 'queued' and p_event = 'prepare' and p_next_state = 'preparing' then
    transition_valid := true;
  elsif journal_row.state = 'queued' and p_event = 'cancel' and p_next_state = 'cancelled' then
    transition_valid := true;
  elsif journal_row.state = 'preparing' and p_event = 'start' and p_next_state = 'starting'
    and p_evidence ->> 'hostPreflightPassed' = 'true' then
    transition_valid := true;
  elsif journal_row.state = 'starting' and p_event = 'started' and p_next_state = 'running'
    and p_evidence ->> 'vmIsolationVerified' = 'true'
    and p_evidence ->> 'resourceLimitsVerified' = 'true'
    and p_evidence ->> 'networkIsolationVerified' = 'true' then
    transition_valid := true;
  elsif journal_row.state in ('preparing', 'starting', 'running')
    and p_event = 'stop' and p_next_state = 'stopping' then
    transition_valid := true;
  elsif journal_row.state = 'stopping' and p_event = 'succeed' and p_next_state = 'succeeded'
    and p_evidence ->> 'vmStopped' = 'true'
    and p_evidence ->> 'artifactValidated' = 'true'
    and p_evidence ->> 'cleanupComplete' = 'true' then
    transition_valid := true;
  elsif journal_row.state in ('preparing', 'starting', 'running', 'stopping')
    and p_event = 'fail' and p_next_state = 'failed'
    and p_evidence ->> 'vmStopped' = 'true'
    and p_evidence ->> 'cleanupComplete' = 'true' then
    transition_valid := true;
  elsif journal_row.state = 'stopping' and p_event = 'cancel' and p_next_state = 'cancelled'
    and p_evidence ->> 'vmStopped' = 'true'
    and p_evidence ->> 'cleanupComplete' = 'true' then
    transition_valid := true;
  end if;

  if not transition_valid then
    raise exception 'Invalid supervisor state transition';
  end if;

  insert into public.build_job_supervisor_events (
    job_id, sequence, event_id, event, occurred_at, from_state, to_state, evidence
  ) values (
    p_job_id, journal_row.sequence + 1, p_event_id, p_event, p_occurred_at,
    journal_row.state, p_next_state, p_evidence
  );

  update public.build_job_supervisor_journals
     set sequence = sequence + 1, state = p_next_state, updated_at = now()
   where build_job_supervisor_journals.job_id = p_job_id;

  return query select p_job_id, journal_row.sequence + 1, p_event_id, p_event,
    p_occurred_at, journal_row.state, p_next_state, p_evidence;
end;
$$;

revoke all on function public.append_deplo_supervisor_event(uuid, text, text, text, integer, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.append_deplo_supervisor_event(uuid, text, text, text, integer, text, text, jsonb)
  to service_role;
