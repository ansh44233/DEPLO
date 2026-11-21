create table if not exists public.github_webhook_deliveries (
  delivery_id text primary key,
  repository_full_name text not null,
  branch text not null,
  commit_sha text not null check (commit_sha ~ '^[a-f0-9]{40}$'),
  sender_github_id bigint,
  status text not null default 'received' check (status in ('received', 'processing', 'deployed', 'ignored', 'failed')),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error_code text
);

create index if not exists github_webhook_deliveries_pending_idx
  on public.github_webhook_deliveries (received_at)
  where status = 'received';

alter table public.github_webhook_deliveries enable row level security;

-- This table is accessed only by DEPLO's server-side service-role client.
-- Do not create anon/authenticated policies or expose it through client-side APIs.
