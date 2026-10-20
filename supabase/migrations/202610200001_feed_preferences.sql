begin;
create table public.beta_feed_preferences (
 user_id uuid primary key references public.beta_profiles(id) on delete cascade,
 groups jsonb not null check (jsonb_typeof(groups)='object' and octet_length(groups::text)<=2000),
 updated_at timestamptz not null default now()
);
alter table public.beta_feed_preferences enable row level security;
revoke all on public.beta_feed_preferences from public,anon,authenticated;
grant all on public.beta_feed_preferences to service_role;
alter table public.beta_feed_cache drop constraint beta_feed_cache_cache_key_check;
alter table public.beta_feed_cache add constraint beta_feed_cache_cache_key_check check (
 length(cache_key)<=120 and cache_key !~ '[[:space:]]' and (
  cache_key ~ '^feed-(all|news)-v[1-9][0-9]{0,3}$'
  or cache_key ~ '^feed-markets-v[1-9][0-9]{0,3}(:[A-Z0-9^.,=-]{0,100})?$'
  or cache_key ~ '^feed-markets-v8:[a-f0-9]{64}$'
 )
);
commit;
