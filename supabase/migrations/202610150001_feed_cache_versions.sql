begin;
-- Keep the service-only cache and its existing rows; allow bounded payload
-- versions and validated watchlist symbols without changing privileges or RLS.
alter table public.beta_feed_cache
 drop constraint beta_feed_cache_cache_key_check;
alter table public.beta_feed_cache
 add constraint beta_feed_cache_cache_key_check check (
  length(cache_key) <= 120 and cache_key !~ '[[:space:]]' and (
   cache_key ~ '^feed-(all|news)-v[1-9][0-9]{0,3}$'
   or cache_key ~ '^feed-markets-v[1-9][0-9]{0,3}(:[A-Z0-9^.,=-]{0,100})?$'
  )
 );
commit;
