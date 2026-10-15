-- Run after 202610150001_feed_cache_versions.sql as the migration owner.
-- Every test row and any existing-row update is rolled back.
begin;
do $$
declare test_key text;
begin
 if not exists(select 1 from pg_class where oid='public.beta_feed_cache'::regclass and relrowsecurity) then
  raise exception 'Feed cache RLS is disabled';
 end if;
 if has_table_privilege('anon','public.beta_feed_cache','SELECT') or has_table_privilege('authenticated','public.beta_feed_cache','SELECT') then
  raise exception 'Feed cache SELECT privileges exposed';
 end if;
 if not has_table_privilege('service_role','public.beta_feed_cache','SELECT')
  or not has_table_privilege('service_role','public.beta_feed_cache','INSERT')
  or not has_table_privilege('service_role','public.beta_feed_cache','UPDATE') then
  raise exception 'Service-role cache access missing';
 end if;
 foreach test_key in array array[
  'feed-news-v2','feed-all-v2','feed-markets-v2',
  'feed-news-v6','feed-all-v7','feed-markets-v5:',
  'feed-markets-v5:NVDA,MU,VST,JPM,TLT,UNH',
  'feed-markets-v9999:^GSPC,BRK.B,NQ=F,BTC-USD',
  'feed-markets-v5:'||repeat('A',100)
 ] loop
  insert into public.beta_feed_cache(cache_key,payload,expires_at)
   values(test_key,'{"fetchedAt":"2026-10-15T00:00:00Z","headlines":[]}'::jsonb,now()+interval '1 minute')
   on conflict(cache_key) do update set payload=excluded.payload,expires_at=excluded.expires_at;
 end loop;
 foreach test_key in array array[
  'feed-news-v0','feed-all-v01','feed-news-v10000',
  'feed-news-v6:NVDA','feed-other-v6','feed-markets-v5:nvda',
  'feed-markets-v5:https://example.com','feed-markets-v5:AAPL;DROP TABLE',
  'feed-markets-v5:'||repeat('A',101),E'feed-news-v6\n'
 ] loop
  begin
   insert into public.beta_feed_cache(cache_key,payload,expires_at)
    values(test_key,'{}'::jsonb,now());
   raise exception 'Invalid feed cache key accepted: %',test_key;
  exception when check_violation then null;
  end;
 end loop;
end $$;

set local role anon;
do $$ begin
 begin perform 1 from public.beta_feed_cache;raise exception 'Anonymous users can read cache';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role authenticated;
do $$ begin
 begin perform 1 from public.beta_feed_cache;raise exception 'Authenticated users can read cache';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'Feed cache version bounds, watchlist keys, RLS and service-only access passed' as result;
