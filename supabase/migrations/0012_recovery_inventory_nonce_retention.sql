-- Bounded retention cleanup for the recovery inventory nonce ledger.
-- Keep consumed and expired challenges for seven days for operational audit,
-- then allow a trusted service-role maintenance task to prune small batches.
create or replace function public.prune_deplo_recovery_inventory_nonces(
  p_batch_size integer default 200
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 1000 then
    raise exception 'Invalid recovery nonce cleanup batch size';
  end if;

  with eligible as (
    select nonce
      from public.build_recovery_inventory_nonces
     where expires_at < now() - interval '7 days'
        or consumed_at < now() - interval '7 days'
     order by created_at asc
     limit p_batch_size
     for update skip locked
  )
  delete from public.build_recovery_inventory_nonces as ledger
   using eligible
   where ledger.nonce = eligible.nonce;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.prune_deplo_recovery_inventory_nonces(integer) from public, anon, authenticated;
grant execute on function public.prune_deplo_recovery_inventory_nonces(integer) to service_role;
