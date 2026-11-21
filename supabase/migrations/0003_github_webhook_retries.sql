-- Durable retry scheduling and atomic queue claiming for GitHub push deliveries.
alter table public.github_webhook_deliveries
  add column if not exists attempt_count integer not null default 0 check (attempt_count >= 0),
  add column if not exists available_at timestamptz not null default now(),
  add column if not exists claimed_at timestamptz,
  add column if not exists last_error_code text;

create index if not exists github_webhook_deliveries_ready_idx
  on public.github_webhook_deliveries (available_at, received_at)
  where status = 'received';

create index if not exists github_webhook_deliveries_stale_claim_idx
  on public.github_webhook_deliveries (claimed_at)
  where status = 'processing';

-- Claims exactly one event. SKIP LOCKED lets multiple scheduled workers run safely.
create or replace function public.claim_next_github_webhook_delivery()
returns setof public.github_webhook_deliveries
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate public.github_webhook_deliveries;
begin
  select *
    into candidate
    from public.github_webhook_deliveries
   where (
      status = 'received'
      and available_at <= now()
      and attempt_count < 5
   ) or (
      status = 'processing'
      and claimed_at < now() - interval '10 minutes'
      and attempt_count < 5
   )
   order by available_at asc, received_at asc
   for update skip locked
   limit 1;

  if not found then
    return;
  end if;

  update public.github_webhook_deliveries
     set status = 'processing',
         attempt_count = attempt_count + 1,
         claimed_at = now(),
         last_error_code = null
   where delivery_id = candidate.delivery_id
   returning * into candidate;

  return next candidate;
end;
$$;

-- Retry transient failures with capped exponential backoff; terminal after five attempts.
create or replace function public.finish_github_webhook_delivery(
  p_delivery_id text,
  p_status text,
  p_error_code text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.github_webhook_deliveries;
begin
  if p_status not in ('deployed', 'ignored', 'failed') then
    raise exception 'Invalid delivery status';
  end if;

  select *
    into current_row
    from public.github_webhook_deliveries
   where delivery_id = p_delivery_id
   for update;

  if not found or current_row.status <> 'processing' then
    raise exception 'Delivery is not currently processing';
  end if;

  if p_status = 'failed' and current_row.attempt_count < 5 then
    update public.github_webhook_deliveries
       set status = 'received',
           available_at = now() + make_interval(
             secs => least(3600, 30 * (2 ^ greatest(0, attempt_count - 1))::integer)
           ),
           claimed_at = null,
           processed_at = null,
           error_code = p_error_code,
           last_error_code = p_error_code
     where delivery_id = p_delivery_id;
  else
    update public.github_webhook_deliveries
       set status = p_status,
           processed_at = now(),
           claimed_at = null,
           error_code = case when p_status = 'failed' then p_error_code else null end,
           last_error_code = case when p_status = 'failed' then p_error_code else null end
     where delivery_id = p_delivery_id;
  end if;
end;
$$;

revoke all on function public.claim_next_github_webhook_delivery() from public, anon, authenticated;
revoke all on function public.finish_github_webhook_delivery(text, text, text) from public, anon, authenticated;
grant execute on function public.claim_next_github_webhook_delivery() to service_role;
grant execute on function public.finish_github_webhook_delivery(text, text, text) to service_role;
