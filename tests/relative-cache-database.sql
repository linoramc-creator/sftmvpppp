-- Run as migration owner; every test write is rolled back.
begin;
do $$ begin
 if not exists(select 1 from pg_class where oid='public.beta_analysis_cache'::regclass and relrowsecurity)
 or has_table_privilege('anon','public.beta_analysis_cache','SELECT')
 or has_table_privilege('authenticated','public.beta_analysis_cache','SELECT') then
  raise exception 'Analysis cache must remain service-only with RLS enabled';
 end if;
 if not has_table_privilege('service_role','public.beta_analysis_cache','INSERT') then
  raise exception 'Service-role write privilege missing';
 end if;
 insert into public.beta_analysis_cache(cache_key,kind,subject,payload,expires_at)
 values('relative-regression-test','relative','SPY:QQQ','{"symbols":["SPY","QQQ"]}',now()+interval '1 minute')
 on conflict(cache_key) do update set payload=excluded.payload;
 begin
  insert into public.beta_analysis_cache(cache_key,kind,subject,payload,expires_at)
  values('relative-invalid-test','private-account','SPY','{}',now());
  raise exception 'Unexpected cache kind accepted';
 exception when check_violation then null;
 end;
 begin
  insert into public.beta_analysis_cache(cache_key,kind,subject,payload,expires_at)
  values(repeat('x',101),'relative','SPY','{}',now());
  raise exception 'Cache key length bound lost';
 exception when check_violation then null;
 end;
end $$;
set local role anon;
do $$ begin
 begin perform 1 from public.beta_analysis_cache;raise exception 'Anonymous cache read allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role authenticated;
do $$ begin
 begin perform 1 from public.beta_analysis_cache;raise exception 'Authenticated direct cache read allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'Relative cache, bounds and service-only access passed' as result;
