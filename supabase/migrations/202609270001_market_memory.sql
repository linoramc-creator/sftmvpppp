begin;

-- Public market analyses only. The table contains no user IDs or account data;
-- access is restricted to the edge function's service role.
create table public.beta_analysis_cache (
  cache_key text primary key check (length(cache_key) between 3 and 100),
  kind text not null check (kind in ('ticker','etf','sector')),
  subject text not null check (length(subject) between 1 and 80),
  payload jsonb not null check (octet_length(payload::text) <= 500000),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index beta_analysis_cache_expiry on public.beta_analysis_cache(expires_at);
alter table public.beta_analysis_cache enable row level security;
revoke all on public.beta_analysis_cache from public,anon,authenticated;
grant all on public.beta_analysis_cache to service_role;

commit;
