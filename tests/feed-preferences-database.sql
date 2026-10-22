-- Run after 202610220002_feed_ten_etfs.sql as the migration owner.
begin;
do $$ begin
 if not exists(select 1 from pg_class where oid='public.beta_feed_preferences'::regclass and relrowsecurity) then raise exception 'Feed preferences RLS is disabled';end if;
 if has_table_privilege('anon','public.beta_feed_preferences','SELECT') or has_table_privilege('authenticated','public.beta_feed_preferences','SELECT') or has_table_privilege('authenticated','public.beta_feed_preferences','INSERT') or has_table_privilege('authenticated','public.beta_feed_preferences','UPDATE') then raise exception 'Feed preferences privileges exposed';end if;
 if not has_table_privilege('service_role','public.beta_feed_preferences','SELECT') or not has_table_privilege('service_role','public.beta_feed_preferences','INSERT') or not has_table_privilege('service_role','public.beta_feed_preferences','UPDATE') then raise exception 'Service-role preferences access missing';end if;
 insert into public.beta_feed_cache(cache_key,payload,expires_at) values('feed-markets-v10:'||repeat('a',64),'{}'::jsonb,now()) on conflict(cache_key) do update set payload=excluded.payload;
 begin
  insert into public.beta_feed_cache(cache_key,payload,expires_at) values('feed-markets-v10:nvda','{}'::jsonb,now());raise exception 'Invalid hash cache key accepted';
 exception when check_violation then null;end;
end $$;
set local role anon;
do $$ begin begin perform 1 from public.beta_feed_preferences;raise exception 'Anonymous users can read preferences';exception when insufficient_privilege then null;end;end $$;
reset role;
set local role authenticated;
do $$ begin begin perform 1 from public.beta_feed_preferences;raise exception 'Authenticated users can read preferences directly';exception when insufficient_privilege then null;end;end $$;
reset role;
rollback;
select 'Feed preferences RLS, service-only access and hashed cache keys passed' as result;
