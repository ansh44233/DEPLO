-- Ensure jobs that exhaust their final attempt cannot remain processing forever.
-- Replaces the claim function introduced in migration 0006.
create or replace function public.claim_next_deplo_build_job()
returns setof public.build_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate public.build_jobs;
begin
  -- Terminalize exhausted jobs before looking for work. This covers workers
  -- that disappear during their final attempt and malformed exhausted pending rows.
  update public.build_jobs
     set status = 'failed',
         claimed_at = null,
         error_code = 'worker_timeout',
         updated_at = now()
   where attempt_count >= max_attempts
     and (
       status = 'pending'
       or (status = 'processing' and claimed_at < now() - interval '15 minutes')
     );

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

revoke all on function public.claim_next_deplo_build_job() from public, anon, authenticated;
grant execute on function public.claim_next_deplo_build_job() to service_role;
