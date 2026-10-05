begin;
-- Public market payloads only; never sessions, private reports or profiles.
create table public.beta_feed_cache (
  cache_key text primary key check (cache_key in ('feed-all-v2','feed-news-v2','feed-markets-v2')),
  payload jsonb not null check (octet_length(payload::text) <= 1500000),
  expires_at timestamptz not null
);
alter table public.beta_feed_cache enable row level security;
revoke all on public.beta_feed_cache from public,anon,authenticated;
grant all on public.beta_feed_cache to service_role;
commit;
