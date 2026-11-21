-- Persist the remote runner handle and schedule polling independently of the DEPLO request.
alter table public.build_jobs
  add column if not exists runner_job_id text,
  add column if not exists runner_status text check (runner_status is null or runner_status in ('queued', 'running', 'succeeded')),
  add column if not exists runner_poll_after timestamptz,
  add column if not exists runner_poll_claimed_at timestamptz,
  add column if not exists artifact_id text,
  add column if not exists artifact_file_count integer check (artifact_file_count is null or artifact_file_count between 0 and 5000),
  add column if not exists artifact_bytes bigint check (artifact_bytes is null or artifact_bytes between 0 and 104857600);

create unique index if not exists build_jobs_runner_job_id_unique on public.build_jobs (runner_job_id) where runner_job_id is not null;
create index if not exists build_jobs_runner_poll_idx on public.build_jobs (runner_poll_after, created_at)
  where status = 'processing' and runner_job_id is not null and runner_status in ('queued', 'running');

create or replace function public.claim_next_deplo_build_job()
returns setof public.build_jobs language plpgsql security definer set search_path = public
as $$
declare candidate public.build_jobs;
begin
  update public.build_jobs set status = 'failed', claimed_at = null, error_code = 'worker_timeout', updated_at = now()
   where attempt_count >= max_attempts
     and (status = 'pending' or (status = 'processing' and runner_job_id is null and claimed_at < now() - interval '15 minutes'));
  select * into candidate from public.build_jobs
   where (status = 'pending' and available_at <= now() and attempt_count < max_attempts)
      or (status = 'processing' and runner_job_id is null and claimed_at < now() - interval '15 minutes' and attempt_count < max_attempts)
   order by available_at asc, created_at asc for update skip locked limit 1;
  if not found then return; end if;
  update public.build_jobs set status = 'processing', attempt_count = attempt_count + 1, claimed_at = now(),
    updated_at = now(), error_code = null, runner_status = null, runner_poll_after = null,
    runner_poll_claimed_at = null, artifact_id = null, artifact_file_count = null, artifact_bytes = null
   where id = candidate.id returning * into candidate;
  return next candidate;
end;
$$;

create or replace function public.claim_next_deplo_runner_poll_job()
returns setof public.build_jobs language plpgsql security definer set search_path = public
as $$
declare candidate public.build_jobs;
begin
  select * into candidate from public.build_jobs where status = 'processing' and runner_job_id is not null
    and runner_status in ('queued', 'running') and runner_poll_after <= now()
    and (runner_poll_claimed_at is null or runner_poll_claimed_at < now() - interval '2 minutes')
   order by runner_poll_after asc, created_at asc for update skip locked limit 1;
  if not found then return; end if;
  update public.build_jobs set runner_poll_claimed_at = now(), updated_at = now()
   where id = candidate.id returning * into candidate;
  return next candidate;
end;
$$;

create or replace function public.attach_deplo_runner_job(p_job_id uuid, p_runner_job_id text)
returns boolean language plpgsql security definer set search_path = public
as $$
declare changed integer;
begin
  if p_runner_job_id !~ '^[a-zA-Z0-9_-]{1,128}$' then raise exception 'Invalid runner job ID'; end if;
  update public.build_jobs set runner_job_id = p_runner_job_id, runner_status = 'queued',
    runner_poll_after = now() + interval '10 seconds', runner_poll_claimed_at = null, updated_at = now()
   where id = p_job_id and status = 'processing' and runner_job_id is null;
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

create or replace function public.schedule_deplo_runner_poll(p_job_id uuid, p_runner_status text, p_delay_seconds integer)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if p_runner_status not in ('queued', 'running') or p_delay_seconds not between 5 and 300 then raise exception 'Invalid runner poll schedule'; end if;
  update public.build_jobs set runner_status = p_runner_status,
    runner_poll_after = now() + make_interval(secs => p_delay_seconds), runner_poll_claimed_at = null, updated_at = now()
   where id = p_job_id and status = 'processing' and runner_job_id is not null;
  if not found then raise exception 'Runner build job is not active'; end if;
end;
$$;

create or replace function public.release_deplo_runner_poll_claim(p_job_id uuid, p_delay_seconds integer)
returns void language plpgsql security definer set search_path = public
as $$
begin
  update public.build_jobs set runner_poll_after = now() + make_interval(secs => greatest(5, least(300, p_delay_seconds))),
    runner_poll_claimed_at = null, updated_at = now()
   where id = p_job_id and status = 'processing' and runner_job_id is not null and runner_status in ('queued', 'running');
end;
$$;

create or replace function public.save_deplo_runner_artifact(p_job_id uuid, p_artifact_id text, p_output_file_count integer, p_output_bytes bigint)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if p_artifact_id !~ '^[a-zA-Z0-9_-]{1,128}$' or p_output_file_count not between 0 and 5000
     or p_output_bytes not between 0 and 104857600 then raise exception 'Invalid artifact metadata'; end if;
  update public.build_jobs set runner_status = 'succeeded', artifact_id = p_artifact_id,
    artifact_file_count = p_output_file_count, artifact_bytes = p_output_bytes, runner_poll_after = null,
    runner_poll_claimed_at = null, claimed_at = null, updated_at = now()
   where id = p_job_id and status = 'processing' and runner_job_id is not null;
  if not found then raise exception 'Runner build job is not active'; end if;
end;
$$;

create or replace function public.finish_deplo_build_job(p_job_id uuid, p_status text, p_error_code text default null)
returns void language plpgsql security definer set search_path = public
as $$
declare current_row public.build_jobs; safe_error text;
begin
  if p_status not in ('succeeded', 'failed') then raise exception 'Invalid build job result'; end if;
  safe_error := case when p_error_code ~ '^[a-z0-9_]{1,64}$' then p_error_code else 'build_failed' end;
  select * into current_row from public.build_jobs where id = p_job_id for update;
  if not found or current_row.status <> 'processing' then raise exception 'Build job is not currently processing'; end if;
  if p_status = 'failed' and current_row.attempt_count < current_row.max_attempts then
    update public.build_jobs set status = 'pending',
      available_at = now() + make_interval(secs => least(1800, 30 * (2 ^ greatest(0, attempt_count - 1))::integer)),
      claimed_at = null, error_code = safe_error, runner_job_id = null, runner_status = null,
      runner_poll_after = null, runner_poll_claimed_at = null, artifact_id = null,
      artifact_file_count = null, artifact_bytes = null, updated_at = now() where id = p_job_id;
  else
    update public.build_jobs set status = p_status, claimed_at = null,
      error_code = case when p_status = 'failed' then safe_error else null end,
      runner_poll_after = null, runner_poll_claimed_at = null, updated_at = now() where id = p_job_id;
  end if;
end;
$$;

revoke all on function public.claim_next_deplo_build_job() from public, anon, authenticated;
revoke all on function public.claim_next_deplo_runner_poll_job() from public, anon, authenticated;
revoke all on function public.attach_deplo_runner_job(uuid, text) from public, anon, authenticated;
revoke all on function public.schedule_deplo_runner_poll(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.release_deplo_runner_poll_claim(uuid, integer) from public, anon, authenticated;
revoke all on function public.save_deplo_runner_artifact(uuid, text, integer, bigint) from public, anon, authenticated;
revoke all on function public.finish_deplo_build_job(uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_next_deplo_build_job() to service_role;
grant execute on function public.claim_next_deplo_runner_poll_job() to service_role;
grant execute on function public.attach_deplo_runner_job(uuid, text) to service_role;
grant execute on function public.schedule_deplo_runner_poll(uuid, text, integer) to service_role;
grant execute on function public.release_deplo_runner_poll_claim(uuid, integer) to service_role;
grant execute on function public.save_deplo_runner_artifact(uuid, text, integer, bigint) to service_role;
grant execute on function public.finish_deplo_build_job(uuid, text, text) to service_role;
