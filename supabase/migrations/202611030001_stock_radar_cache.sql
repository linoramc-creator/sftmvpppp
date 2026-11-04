begin;

-- Public research data only. Existing feed rows, preferences and reports are
-- deliberately independent of this singleton cache and its refresh lease.
create table public.beta_stock_radar_cache (
 cache_key text primary key check(cache_key='radar-v1'),
 payload jsonb check(payload is null or jsonb_typeof(payload)='object' and octet_length(payload::text)<=500000),
 expires_at timestamptz not null default '-infinity',
 lease_token uuid,lease_until timestamptz,retry_at timestamptz not null default '-infinity'
);
alter table public.beta_stock_radar_cache enable row level security;
revoke all on public.beta_stock_radar_cache from public,anon,authenticated,service_role;

create function public.beta_stock_radar_job(operation text,claim_token uuid default null,output jsonb default null)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.beta_stock_radar_cache;prior jsonb;
begin
 if operation not in ('claim','finish','fail') then raise exception 'RADAR_INVALID';end if;
 perform pg_advisory_xact_lock(81031103);
 insert into public.beta_stock_radar_cache(cache_key) values('radar-v1') on conflict do nothing;
 select * into job from public.beta_stock_radar_cache where cache_key='radar-v1' for update;
 if job.payload is not null and (job.payload->>'fetchedAt')::timestamptz>now()-interval '24 hours' then prior=job.payload;end if;
 if operation='claim' then
  if job.payload is not null and job.expires_at>now() and prior is not null then return jsonb_build_object('state','ready','payload',prior);end if;
  if job.lease_until>now() then return jsonb_build_object('state','building','payload',prior);end if;
  if job.retry_at>now() then return jsonb_build_object('state','cooling','payload',prior);end if;
  update public.beta_stock_radar_cache set lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes' where cache_key='radar-v1' returning * into job;
  return jsonb_build_object('state','claimed','token',job.lease_token,'payload',prior);
 end if;
 if claim_token is null or job.lease_token is distinct from claim_token or job.lease_until is null or job.lease_until<=now() then raise exception 'RADAR_CONFLICT';end if;
 if operation='fail' then
  update public.beta_stock_radar_cache set lease_token=null,lease_until=null,retry_at=now()+interval '15 minutes' where cache_key='radar-v1';
  return '{}'::jsonb;
 end if;
 if output is null or jsonb_typeof(output)<>'object' or octet_length(output::text)>500000
  or coalesce(jsonb_typeof(output->'candidates'),'')<>'array' or jsonb_array_length(output->'candidates') not between 1 and 12
  or coalesce(output->>'status','') not in ('ready','partial') or output->>'horizonMonths' is distinct from '6'
  or coalesce(output->>'fetchedAt','')='' or (output->>'fetchedAt')::timestamptz<now()-interval '10 minutes' or (output->>'fetchedAt')::timestamptz>now()+interval '1 minute'
  then raise exception 'RADAR_INVALID';end if;
 update public.beta_stock_radar_cache set payload=output,expires_at=now()+interval '6 hours',lease_token=null,lease_until=null,retry_at='-infinity' where cache_key='radar-v1';
 return '{}'::jsonb;
end $$;
revoke all on function public.beta_stock_radar_job(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.beta_stock_radar_job(text,uuid,jsonb) to service_role;
commit;
