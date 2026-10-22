begin;

-- Expand only the previously supplied default basket, once. Explicit custom
-- choices and future seven-ETF selections remain untouched by normal reads.
update public.beta_feed_preferences
set groups=jsonb_set(groups,'{etfs}','["SPY","QQQ","URTH","IWM","VEA","VWO","TLT","GLD","HYG","LQD"]'::jsonb),
    updated_at=now()
where groups->'etfs'='["SPY","QQQ","URTH","IWM","VEA","VWO","TLT"]'::jsonb;

-- Include the new feed generation's SHA-256 keys as well as legacy formats.
alter table public.beta_feed_cache drop constraint beta_feed_cache_cache_key_check;
alter table public.beta_feed_cache add constraint beta_feed_cache_cache_key_check check (
 length(cache_key)<=120 and cache_key !~ '[[:space:]]' and (
  cache_key ~ '^feed-(all|news)-v[1-9][0-9]{0,3}$'
  or cache_key ~ '^feed-markets-v[1-9][0-9]{0,3}(:[A-Z0-9^.,=-]{0,100})?$'
  or cache_key ~ '^feed-markets-v[1-9][0-9]{0,3}:[a-f0-9]{64}$'
 )
);

-- Keep owner identities, other groups, grants and RLS policies intact.
commit;
