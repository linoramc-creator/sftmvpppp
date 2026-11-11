begin;

-- Definitions only. Market results are calculated on the server and are never
-- accepted as user-supplied evidence or persisted into the trading ledger.
create table public.beta_analytics_queries (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.beta_profiles(id) on delete cascade,
 request_id uuid not null,
 create_hash text not null,
 name text not null check(name=btrim(name) and length(name) between 1 and 100 and name !~ '[[:cntrl:]<>]'),
 query jsonb not null check(jsonb_typeof(query)='object' and query->>'version'='1' and octet_length(query::text)<=12000),
 revision integer not null default 1 check(revision>0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 deleted_at timestamptz,
 unique(user_id,request_id)
);
create index beta_analytics_queries_owner on public.beta_analytics_queries(user_id,updated_at desc) where deleted_at is null;
alter table public.beta_analytics_queries enable row level security;
revoke all on public.beta_analytics_queries from public,anon,authenticated,service_role;

create function public.beta_analytics_store(operation text,uid uuid,payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item public.beta_analytics_queries; result jsonb; item_id uuid; request uuid; signature text;
begin
 if current_user<>'postgres' and auth.role() is distinct from 'service_role' then raise exception 'BETA_ANALYTICS_FORBIDDEN';end if;
 if uid is null or not public.beta_active_user(uid) then raise exception 'BETA_ANALYTICS_FORBIDDEN';end if;
 if operation not in ('list','save','delete') or jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>16000 then raise exception 'BETA_ANALYTICS_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('analytics:'||uid::text,0));
 if operation='list' then
  select coalesce(jsonb_agg(to_jsonb(q) order by q.updated_at desc,q.id),'[]'::jsonb) into result from (select id,name,query,revision,created_at,updated_at from public.beta_analytics_queries where user_id=uid and deleted_at is null order by updated_at desc,id limit 100) q;
  return result;
 end if;
 if payload ? 'id' then
  item_id:=(payload->>'id')::uuid;
  select * into item from public.beta_analytics_queries where id=item_id and user_id=uid and deleted_at is null for update;
  if not found then raise exception 'BETA_ANALYTICS_NOT_FOUND';end if;
  if item.revision is distinct from (payload->>'revision')::integer then raise exception 'BETA_ANALYTICS_CONFLICT';end if;
  if operation='delete' then update public.beta_analytics_queries set deleted_at=now(),revision=revision+1,updated_at=now() where id=item.id;return jsonb_build_object('ok',true);end if;
 elsif operation='delete' then raise exception 'BETA_ANALYTICS_INVALID';end if;
 if jsonb_typeof(payload->'name') is distinct from 'string' or length(btrim(payload->>'name')) not between 1 and 100 or payload->>'name' ~ '[[:cntrl:]<>]'
  or jsonb_typeof(payload->'query') is distinct from 'object' or payload->'query'->>'version' is distinct from '1' or octet_length((payload->'query')::text)>12000
  or jsonb_typeof(payload->'query'->'assets') is distinct from 'array' or jsonb_array_length(payload->'query'->'assets')>12
  or payload->'query'->>'dataKind' is distinct from 'reported'
  or coalesce(payload->'query'->>'operation','') not in ('level','base100','growth_yoy','growth_qoq','ratio')
  or coalesce(payload->'query'->>'metric','') not in ('price','revenue','netIncome','grossProfit','operatingCashFlow','freeCashFlow','capex','capexAI','cash','totalDebt','equity','totalAssets','portfolioExposure')
  or exists(select 1 from jsonb_object_keys(payload->'query') k where k not in ('version','assets','metric','operation','denominator','period','frequency','currency','chart','dataKind','portfolioId'))
 then raise exception 'BETA_ANALYTICS_INVALID';end if;
 if item_id is null then
  request:=(payload->>'requestId')::uuid;if request is null then raise exception 'BETA_ANALYTICS_INVALID';end if;
  signature:=md5(btrim(payload->>'name')||(payload->'query')::text);
  select * into item from public.beta_analytics_queries where user_id=uid and request_id=request;
  if found then
   if item.deleted_at is not null then raise exception 'BETA_ANALYTICS_NOT_FOUND';end if;
   if item.create_hash<>signature then raise exception 'BETA_ANALYTICS_CONFLICT';end if;
  else
   if (select count(*) from public.beta_analytics_queries where user_id=uid and deleted_at is null)>=100 then raise exception 'BETA_ANALYTICS_LIMIT';end if;
   insert into public.beta_analytics_queries(user_id,request_id,create_hash,name,query) values(uid,request,signature,btrim(payload->>'name'),payload->'query') returning * into item;
  end if;
 else
  update public.beta_analytics_queries set name=btrim(payload->>'name'),query=payload->'query',revision=revision+1,updated_at=now() where id=item.id returning * into item;
 end if;
 return jsonb_build_object('id',item.id,'name',item.name,'query',item.query,'revision',item.revision,'created_at',item.created_at,'updated_at',item.updated_at);
end $$;
revoke all on function public.beta_analytics_store(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.beta_analytics_store(text,uuid,jsonb) to service_role;

-- Read the same owned portfolio state and currency as the simulator. No refresh,
-- order, fill or valuation write is performed, even when its marks are stale.
create function public.beta_analytics_portfolio(uid uuid,pid uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if current_user<>'postgres' and auth.role() is distinct from 'service_role' then raise exception 'BETA_ANALYTICS_FORBIDDEN';end if;
 if uid is null or not public.beta_active_user(uid) or not public.beta_is_admin(uid)
  or not exists(select 1 from public.beta_profiles where id=uid and lower(email)='linoramc@gmail.com') then raise exception 'BETA_ANALYTICS_FORBIDDEN';end if;
 select jsonb_build_object('id',id,'name',name,'state',state) into result from public.beta_paper_portfolios where user_id=uid and not archived and (pid is null or id=pid) order by updated_at desc,id limit 1;
 return result;
end $$;
revoke all on function public.beta_analytics_portfolio(uuid,uuid) from public,anon,authenticated;
grant execute on function public.beta_analytics_portfolio(uuid,uuid) to service_role;

-- Retire opportunity alerts without deleting historical news/read receipts.
update public.beta_monitor_alerts set enabled=false,revision=revision+1,updated_at=now() where enabled;
create function beta_private.monitor_alerts_retired() returns trigger language plpgsql set search_path='' as $$
begin if new.enabled then raise exception 'BETA_MONITOR_ALERTS_DISABLED';end if;return new;end $$;
create trigger beta_monitor_alerts_retired before insert or update of enabled on public.beta_monitor_alerts for each row execute function beta_private.monitor_alerts_retired();
revoke all on function beta_private.monitor_alerts_retired() from public,anon,authenticated;

commit;
