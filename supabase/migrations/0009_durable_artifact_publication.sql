-- Durable lease for artifact validation and Cloudflare publication.
alter table public.build_jobs
  add column if not exists artifact_publish_claimed_at timestamptz;

create index if not exists build_jobs_artifact_publish_idx
  on public.build_jobs (updated_at, created_at)
  where status = 'processing'
    and runner_status = 'succeeded'
    and artifact_id is not null;

create or replace function public.claim_next_deplo_artifact_publish_job()
returns setof public.build_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate public.build_jobs;
begin
  select * into candidate
    from public.build_jobs
   where status = 'processing'
     and runner_status = 'succeeded'
     and artifact_id is not null
     and artifact_file_count is not null
     and artifact_bytes is not null
     and (
       artifact_publish_claimed_at is null
       or artifact_publish_claimed_at < now() - interval '10 minutes'
     )
   order by updated_at asc, created_at asc
   for update skip locked
   limit 1;

  if not found then return; end if;

  update public.build_jobs
     set artifact_publish_claimed_at = now(), updated_at = now()
   where id = candidate.id
   returning * into candidate;

  return next candidate;
end;
$$;

-- A failed publication returns the whole build to the existing retry queue.
-- The next attempt must obtain a fresh runner job and artifact.
create or replace function public.finish_deplo_build_job(
  p_job_id uuid,
  p_status text,
  p_error_code text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.build_jobs;
  safe_error text;
begin
  if p_status not in ('succeeded', 'failed') then
    raise exception 'Invalid build job result';
  end if;

  safe_error := case
    when p_error_code ~ '^[a-z0-9_]{1,64}$' then p_error_code
    else 'build_failed'
  end;

  select * into current_row
    from public.build_jobs
   where id = p_job_id
   for update;

  if not found or current_row.status <> 'processing' then
    raise exception 'Build job is not currently processing';
  end if;

  if p_status = 'failed' and current_row.attempt_count < current_row.max_attempts then
    update public.build_jobs
       set status = 'pending',
           available_at = now() + make_interval(secs => least(1800, 30 * (2 ^ greatest(0, attempt_count - 1))::integer)),
           claimed_at = null,
           error_code = safe_error,
           runner_job_id = null,
           runner_status = null,
           runner_poll_after = null,
           runner_poll_claimed_at = null,
           artifact_id = null,
           artifact_file_count = null,
           artifact_bytes = null,
           artifact_publish_claimed_at = null,
           updated_at = now()
     where id = p_job_id;
  else
    update public.build_jobs
       set status = p_status,
           claimed_at = null,
           error_code = case when p_status = 'failed' then safe_error else null end,
           runner_poll_after = null,
           runner_poll_claimed_at = null,
           artifact_publish_claimed_at = null,
           updated_at = now()
     where id = p_job_id;
  end if;
end;
$$;

revoke all on function public.claim_next_deplo_artifact_publish_job() from public, anon, authenticated;
grant execute on function public.claim_next_deplo_artifact_publish_job() to service_role;
