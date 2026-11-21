-- Durable, account-scoped queue metadata. This migration does not execute builds.
alter table public.projects
  add constraint projects_id_owner_unique unique (id, owner_github_id);

create table if not exists public.build_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  owner_github_id bigint not null,
  source_commit_sha text not null check (source_commit_sha ~ '^[a-f0-9]{40}$'),
  framework text not null check (framework in ('vite', 'react', 'create-react-app', 'nextjs-static')),
  package_manager text not null check (package_manager in ('npm', 'pnpm', 'yarn', 'bun')),
  output_directory text not null check (output_directory in ('dist', 'build', 'out')),
  status text not null default 'pending' check (status in ('pending', 'processing', 'succeeded', 'failed', 'cancelled')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 5),
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  error_code text check (error_code is null or error_code ~ '^[a-z0-9_]{1,64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (project_id, owner_github_id)
    references public.projects (id, owner_github_id) on delete cascade
);

create index if not exists build_jobs_owner_project_idx
  on public.build_jobs (owner_github_id, project_id, created_at desc);
create index if not exists build_jobs_ready_idx
  on public.build_jobs (available_at, created_at)
  where status = 'pending';
create index if not exists build_jobs_stale_claim_idx
  on public.build_jobs (claimed_at)
  where status = 'processing';

alter table public.build_jobs enable row level security;
revoke all on public.build_jobs from anon, authenticated;
grant all on public.build_jobs to service_role;

-- Atomic claim allows multiple isolated runners without double-processing a job.
create or replace function public.claim_next_deplo_build_job()
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
   where (
     status = 'pending' and available_at <= now() and attempt_count < max_attempts
   ) or (
     status = 'processing' and claimed_at < now() - interval '15 minutes'
       and attempt_count < max_attempts
   )
   order by available_at asc, created_at asc
   for update skip locked
   limit 1;

  if not found then return; end if;

  update public.build_jobs
     set status = 'processing', attempt_count = attempt_count + 1,
         claimed_at = now(), updated_at = now(), error_code = null
   where id = candidate.id
   returning * into candidate;

  return next candidate;
end;
$$;

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

  select * into current_row from public.build_jobs
   where id = p_job_id for update;
  if not found or current_row.status <> 'processing' then
    raise exception 'Build job is not currently processing';
  end if;

  if p_status = 'failed' and current_row.attempt_count < current_row.max_attempts then
    update public.build_jobs
       set status = 'pending',
           available_at = now() + make_interval(secs => least(1800, 30 * (2 ^ greatest(0, attempt_count - 1))::integer)),
           claimed_at = null, error_code = safe_error, updated_at = now()
     where id = p_job_id;
  else
    update public.build_jobs
       set status = p_status, claimed_at = null,
           error_code = case when p_status = 'failed' then safe_error else null end,
           updated_at = now()
     where id = p_job_id;
  end if;
end;
$$;

revoke all on function public.claim_next_deplo_build_job() from public, anon, authenticated;
revoke all on function public.finish_deplo_build_job(uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_next_deplo_build_job() to service_role;
grant execute on function public.finish_deplo_build_job(uuid, text, text) to service_role;
