begin;

-- Shared market evidence is collected once per asset. User rules, receipts and
-- visit baselines remain private; no browser or direct service table access.
create table public.beta_monitor_assets (
 symbol text primary key check(symbol ~ '^[A-Z0-9^][A-Z0-9.^=-]{0,14}$'),
 snapshot jsonb check(snapshot is null or octet_length(snapshot::text)<=150000),
 collected_at timestamptz,
 due_at timestamptz not null default now(),
 lease_token uuid,
 lease_until timestamptz,
 failures integer not null default 0 check(failures between 0 and 100),
 last_commit_token uuid,
 last_commit_hash text,
 updated_at timestamptz not null default now()
);
create table public.beta_monitor_history (
 id bigint generated always as identity primary key,
 symbol text not null references public.beta_monitor_assets(symbol) on delete cascade,
 observed_at timestamptz not null,
 metrics jsonb not null check(jsonb_typeof(metrics)='object' and octet_length(metrics::text)<=20000),
 unique(symbol,observed_at)
);
create index beta_monitor_history_asset on public.beta_monitor_history(symbol,observed_at desc);
create table public.beta_monitor_events (
 id uuid primary key default gen_random_uuid(),
 symbol text not null,
 key text not null unique check(length(key) between 1 and 250),
 data jsonb not null check(octet_length(data::text)<=12000),
 occurred_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp()
);
create index beta_monitor_events_asset on public.beta_monitor_events(symbol,created_at desc);
create table public.beta_monitor_alerts (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.beta_profiles(id) on delete cascade,
 create_request_id uuid not null,
 create_hash text not null,
 symbol text not null check(symbol ~ '^[A-Z0-9^][A-Z0-9.^=-]{0,14}$'),
 name text not null check(length(name) between 1 and 80),
 conditions jsonb not null,
 enabled boolean not null default true,
 revision integer not null default 1 check(revision>0),
 last_matched boolean not null default false,
 last_observed_at timestamptz,
 last_notified_at timestamptz,
 trigger_count integer not null default 0 check(trigger_count>=0),
 evaluation jsonb check(evaluation is null or octet_length(evaluation::text)<=20000),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(user_id,create_request_id)
);
create index beta_monitor_alerts_owner on public.beta_monitor_alerts(user_id,created_at desc);
create index beta_monitor_alerts_asset on public.beta_monitor_alerts(symbol) where enabled;
create table public.beta_monitor_alert_requests (
 user_id uuid not null references public.beta_profiles(id) on delete cascade,
 request_id uuid not null,
 fingerprint text not null,
 alert_id uuid references public.beta_monitor_alerts(id) on delete set null,
 created_at timestamptz not null default now(),
 primary key(user_id,request_id)
);
create table public.beta_monitor_notices (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.beta_profiles(id) on delete cascade,
 key text not null,
 alert_id uuid,
 data jsonb not null check(octet_length(data::text)<=24000),
 created_at timestamptz not null,
 read_at timestamptz,
 unique(user_id,key),
 unique(user_id,created_at)
);
create index beta_monitor_notices_owner on public.beta_monitor_notices(user_id,created_at desc);
create table public.beta_monitor_visitors (
 user_id uuid primary key references public.beta_profiles(id) on delete cascade,
 visit_at timestamptz not null,
 baseline timestamptz,
 last_seen_at timestamptz not null
);
create table public.beta_monitor_visits (
 user_id uuid not null references public.beta_profiles(id) on delete cascade,
 visit_id uuid not null,
 baseline timestamptz,
 visit_at timestamptz not null,
 created_at timestamptz not null default now(),
 primary key(user_id,visit_id)
);
create table public.beta_monitor_analysis_budget (
 day date primary key,
 batches integer not null check(batches between 0 and 96)
);
do $$declare name text;begin
 foreach name in array array['beta_monitor_assets','beta_monitor_history','beta_monitor_events','beta_monitor_alerts','beta_monitor_alert_requests','beta_monitor_notices','beta_monitor_visitors','beta_monitor_visits','beta_monitor_analysis_budget'] loop
  execute format('alter table public.%I enable row level security',name);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',name);
 end loop;
end $$;
revoke all on sequence public.beta_monitor_history_id_seq from public,anon,authenticated,service_role;

create function beta_private.monitor_time(value text) returns timestamptz
language plpgsql immutable set search_path='' as $$begin
 if value ~ '^\d{4}-\d{2}-\d{2}$' then return (value||'T00:00:00Z')::timestamptz;end if;
 if value !~ '^\d{4}-\d{2}-\d{2}T[0-9:.]+(Z|[+-][0-9]{2}:[0-9]{2})$' then return null;end if;
 return value::timestamptz;
exception when others then return null;end $$;

create function beta_private.monitor_conditions(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$declare item jsonb; amount numeric;begin
 if jsonb_typeof(value) is distinct from 'array' then return false;end if;
 if jsonb_array_length(value) not between 1 and 5 then return false;end if;
 for item in select v from jsonb_array_elements(value) v loop
  if jsonb_typeof(item) is distinct from 'object' or not item ?& array['field','op','value']
   or exists(select 1 from jsonb_object_keys(item) k where k not in ('field','op','value','currency','period'))
   or coalesce(item->>'field','') not in ('price','changePct','pe','pb','marketCap','revenueGrowthPct','epsEstimate','earningsWithinDays')
   or coalesce(item->>'op','') not in ('gt','gte','lt','lte') or jsonb_typeof(item->'value') is distinct from 'number' then return false;end if;
  amount:=(item->>'value')::numeric;if abs(amount)>(case when item->>'field'='marketCap' then 10000000000000000 else 1000000000000 end) then return false;end if;
  if item->>'field' in ('price','marketCap','epsEstimate') and coalesce(item->>'currency','') !~ '^[A-Z]{3}$' then return false;end if;
  if item ? 'currency' and coalesce(item->>'currency','') !~ '^[A-Z]{3}$' then return false;end if;
  if item ? 'period' and (jsonb_typeof(item->'period') is distinct from 'string' or length(item->>'period') not between 1 and 80 or item->>'period' ~ '[[:cntrl:]<>]') then return false;end if;
 end loop;return true;
exception when others then return false;end $$;
alter table public.beta_monitor_alerts add constraint beta_monitor_alerts_conditions check(beta_private.monitor_conditions(conditions));

create function beta_private.monitor_alert_json(item public.beta_monitor_alerts) returns jsonb
language sql stable set search_path='' as $$select jsonb_build_object('id',item.id,'symbol',item.symbol,'name',item.name,'conditions',item.conditions,'enabled',item.enabled,'revision',item.revision,'createdAt',item.created_at,'updatedAt',item.updated_at,'lastMatched',item.last_matched,'lastNotifiedAt',item.last_notified_at,'evaluation',case when item.enabled then item.evaluation else jsonb_build_object('status','paused','matched',null,'reason','Alerta en pausa.','checkedAt',item.updated_at,'conditions','[]'::jsonb) end);$$;

-- Positions are read from their authoritative record, never copied into a new
-- user-owned position table. Even service callers cannot obtain other owners.
create function beta_private.monitor_subscriptions(owner uuid default null) returns table(user_id uuid,symbol text)
language sql stable security definer set search_path='' as $$
 with eligible as (select p.id from public.beta_profiles p where (owner is null or p.id=owner) and public.beta_active_user(p.id)),
 direct as (
  select w.user_id,s.symbol from public.beta_watchlists w join eligible u on u.id=w.user_id cross join lateral unnest(w.symbols) s(symbol)
  union select a.user_id,a.symbol from public.beta_monitor_alerts a join eligible u on u.id=a.user_id where a.enabled
  union select p.user_id,pos.item->>'symbol' from public.beta_paper_portfolios p join eligible u on u.id=p.user_id join auth.users au on au.id=p.user_id
   cross join lateral jsonb_array_elements(p.state->'positions') pos(item)
   where not p.archived and public.beta_is_admin(p.user_id) and lower(au.email)='linoramc@gmail.com' and au.email_confirmed_at is not null
    and case when jsonb_typeof(pos.item->'quantity')='number' then (pos.item->>'quantity')::numeric<>0 else false end
 ), indirect as (
  select d.user_id,h.item->>'symbol' as symbol from direct d join public.beta_monitor_assets a on a.symbol=d.symbol
  cross join lateral jsonb_array_elements(coalesce(nullif(a.snapshot->'holdings'->'items','null'::jsonb),'[]'::jsonb)) with ordinality h(item,n)
  where a.snapshot->>'kind'='etf' and h.n<=10
   and beta_private.monitor_time(a.snapshot->'holdings'->>'asOf') between now()-interval '180 days' and now()
   and length(coalesce(a.snapshot->'holdings'->>'source',''))>0
   and coalesce(a.snapshot->'holdings'->>'url','') ~ '^https://[^[:space:]<>]+$'
   and case when jsonb_typeof(h.item->'weightPct')='number' then (h.item->>'weightPct')::numeric>0 and (h.item->>'weightPct')::numeric<=100 else false end
 ) select distinct x.user_id,x.symbol from (select * from direct union all select * from indirect) x where x.symbol ~ '^[A-Z0-9^][A-Z0-9.^=-]{0,14}$';
$$;

create function beta_private.monitor_add_notice(owner uuid,change jsonb,rule uuid default null) returns void
language plpgsql set search_path='' as $$declare stamp timestamptz;begin
 if not public.beta_active_user(owner) then return;end if;
 -- The caller holds the user's monitoring advisory lock. Monotonic receipt
 -- timestamps make a timestamp-only pagination cursor lossless across ties.
 select greatest(clock_timestamp(),coalesce(max(created_at)+interval '1 microsecond','epoch'::timestamptz)) into stamp from public.beta_monitor_notices where user_id=owner;
 insert into public.beta_monitor_notices(user_id,key,alert_id,data,created_at) values(owner,change->>'key',rule,change,stamp) on conflict(user_id,key) do nothing;
 delete from public.beta_monitor_notices n where n.user_id=owner and n.id not in (select id from public.beta_monitor_notices where user_id=owner order by created_at desc limit 500);
end $$;

create function beta_private.monitor_evaluation_valid(rules jsonb,snapshot jsonb,evaluation jsonb) returns boolean
language plpgsql stable set search_path='' as $$
declare part jsonb; rule jsonb; metric jsonb; count integer:=0; unknown boolean:=false; unmet boolean:=false; actual boolean; stamp timestamptz; maximum numeric;
begin
 if jsonb_typeof(evaluation) is distinct from 'object' or octet_length(evaluation::text)>20000 or coalesce(evaluation->>'status','') not in ('matched','unmatched','missing','stale')
  or jsonb_typeof(evaluation->'conditions') is distinct from 'array' or jsonb_array_length(evaluation->'conditions')<>jsonb_array_length(rules)
  or beta_private.monitor_time(evaluation->>'checkedAt') is null or beta_private.monitor_time(evaluation->>'checkedAt')>now()+interval '2 minutes'
  or length(coalesce(evaluation->>'reason',''))>2000 then return false;end if;
 for part in select v from jsonb_array_elements(evaluation->'conditions') v loop
  rule:=rules->count;count:=count+1;
  if part->'condition' is distinct from rule or coalesce(part->>'status','') not in ('met','unmet','missing','stale') then return false;end if;
  metric:=snapshot->'metrics'->(rule->>'field');
  if part->>'status' in ('missing','stale') then unknown:=true;continue;end if;
  if jsonb_typeof(metric->'value') is distinct from 'number' or part->'value' is distinct from metric->'value'
   or length(coalesce(metric->>'source','')) not between 1 and 200 or length(coalesce(metric->>'unit','')) not between 1 and 80
   or (rule->>'field' in ('revenueGrowthPct','epsEstimate') and length(coalesce(metric->>'period','')) not between 1 and 80)
   or part->>'source' is distinct from metric->>'source' or part->>'url' is distinct from metric->>'url' or part->>'asOf' is distinct from metric->>'asOf'
   or (rule ? 'currency' and rule->>'currency' is distinct from metric->>'currency')
   or (rule ? 'period' and rule->>'period' is distinct from metric->>'period') then return false;end if;
  stamp:=beta_private.monitor_time(metric->>'asOf');
  if stamp is null or stamp>now() or jsonb_typeof(metric->'maxAgeHours') is distinct from 'number' then return false;end if;
  maximum:=(metric->>'maxAgeHours')::numeric;if maximum<=0 or maximum>8784 or extract(epoch from now()-stamp)>maximum*3600 then return false;end if;
  actual:=case rule->>'op' when 'gt' then (metric->>'value')::numeric>(rule->>'value')::numeric when 'gte' then (metric->>'value')::numeric>=(rule->>'value')::numeric when 'lt' then (metric->>'value')::numeric<(rule->>'value')::numeric else (metric->>'value')::numeric<=(rule->>'value')::numeric end;
  if (part->>'status'='met') is distinct from actual then return false;end if;
  unmet:=unmet or not actual;
 end loop;
 if unmet then return evaluation->'matched'='false'::jsonb and evaluation->>'status'='unmatched';end if;
 if unknown then return evaluation->'matched'='null'::jsonb and evaluation->>'status' in ('missing','stale');end if;
 return evaluation->'matched'='true'::jsonb and evaluation->>'status'='matched';
exception when others then return false;end $$;

create function public.beta_monitor_store(operation text,uid uuid default null,payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 item public.beta_monitor_alerts; asset public.beta_monitor_assets; visitor public.beta_monitor_visitors; visit public.beta_monitor_visits; prior_request public.beta_monitor_alert_requests;
 out jsonb; rows jsonb; config jsonb; snap jsonb; change jsonb; evaluation jsonb; part jsonb; entry jsonb;
 chosen text; request_key uuid; target uuid; token uuid; digest text; owner uuid; recipients uuid[]; collected timestamptz; observed timestamptz; before_at timestamptz; since_at timestamptz; occurred timestamptz; source text; source_url text;
 max_items integer; accepted integer:=0; ignored integer:=0; is_new boolean; changed boolean; limit_count integer; cursor_count integer;
begin
 if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>1500000 then raise exception 'BETA_MONITOR_INVALID';end if;
 if operation in ('claim_assets','commit_asset','fail_asset','status','analysis_budget') then
  if uid is not null then raise exception 'BETA_MONITOR_FORBIDDEN';end if;
 else
  if uid is null then raise exception 'BETA_MONITOR_REVOKED';end if;
  perform pg_advisory_xact_lock(hashtextextended('monitor:'||uid::text,0));
  if not coalesce(public.beta_active_user(uid),false) then raise exception 'BETA_MONITOR_REVOKED';end if;
 end if;

 if operation='context' then
  if payload<>'{}'::jsonb then raise exception 'BETA_MONITOR_INVALID';end if;
  select coalesce(jsonb_agg(beta_private.monitor_alert_json(a) order by a.created_at desc),'[]'::jsonb) into rows from public.beta_monitor_alerts a where a.user_id=uid;
  select jsonb_build_object(
   'watchlist',coalesce((select to_jsonb(w.symbols) from public.beta_watchlists w where w.user_id=uid),'[]'::jsonb),
   'symbols',coalesce((select jsonb_agg(s.symbol order by s.symbol) from beta_private.monitor_subscriptions(uid) s),'[]'::jsonb),
   'portfolios',case when public.beta_is_admin(uid) and exists(select 1 from auth.users u where u.id=uid and lower(u.email)='linoramc@gmail.com' and u.email_confirmed_at is not null) then coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'state',p.state) order by p.created_at) from public.beta_paper_portfolios p where p.user_id=uid and not p.archived),'[]'::jsonb) else '[]'::jsonb end,
   'snapshots',coalesce((select jsonb_agg(a.snapshot order by a.symbol) from public.beta_monitor_assets a join beta_private.monitor_subscriptions(uid) s on s.symbol=a.symbol where a.snapshot is not null),'[]'::jsonb),
   'coverage',coalesce((select jsonb_agg(s.symbol||': pendiente de una primera observación.') from beta_private.monitor_subscriptions(uid) s left join public.beta_monitor_assets a on a.symbol=s.symbol where a.snapshot is null),'[]'::jsonb)
  ) into out;return out;
 elsif operation='visit' then
  if exists(select 1 from jsonb_object_keys(payload) k where k<>'visitId') or coalesce(payload->>'visitId','') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then raise exception 'BETA_MONITOR_INVALID';end if;
  request_key:=(payload->>'visitId')::uuid;select * into visit from public.beta_monitor_visits v where v.user_id=uid and v.visit_id=request_key;
  if found then return jsonb_build_object('baseline',visit.baseline,'visitAt',visit.visit_at);end if;
  select * into visitor from public.beta_monitor_visitors v where v.user_id=uid for update;
  if not found then insert into public.beta_monitor_visitors(user_id,visit_at,baseline,last_seen_at) values(uid,now(),null,now()) returning * into visitor;
  elsif visitor.last_seen_at<now()-interval '30 minutes' then update public.beta_monitor_visitors set baseline=visit_at,visit_at=now(),last_seen_at=now() where user_id=uid returning * into visitor;
  else update public.beta_monitor_visitors set last_seen_at=now() where user_id=uid returning * into visitor;end if;
  insert into public.beta_monitor_visits(user_id,visit_id,baseline,visit_at) values(uid,request_key,visitor.baseline,visitor.visit_at);
  delete from public.beta_monitor_visits v where v.user_id=uid and (v.created_at<now()-interval '90 days' or v.visit_id not in (select visit_id from public.beta_monitor_visits where user_id=uid order by created_at desc limit 1000));
  return jsonb_build_object('baseline',visitor.baseline,'visitAt',visitor.visit_at);
 elsif operation='read' then
  if exists(select 1 from jsonb_object_keys(payload) k where k<>'ids') or jsonb_typeof(payload->'ids') is distinct from 'array' or jsonb_array_length(payload->'ids')>100 then raise exception 'BETA_MONITOR_INVALID';end if;
  for entry in select v from jsonb_array_elements(payload->'ids') v loop
   if jsonb_typeof(entry) is distinct from 'string' or entry#>>'{}' !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then raise exception 'BETA_MONITOR_INVALID';end if;
  end loop;
  update public.beta_monitor_notices n set read_at=coalesce(n.read_at,clock_timestamp()) where n.user_id=uid and n.id in (select (v#>>'{}')::uuid from jsonb_array_elements(payload->'ids') v);
  return jsonb_build_object('ok',true);
 elsif operation='list' then
  if exists(select 1 from jsonb_object_keys(payload) k where k not in ('before','since','unreadOnly')) or (payload ? 'unreadOnly' and jsonb_typeof(payload->'unreadOnly') is distinct from 'boolean') then raise exception 'BETA_MONITOR_INVALID';end if;
  before_at:=case when payload ? 'before' then beta_private.monitor_time(payload->>'before') else 'infinity'::timestamptz end;
  since_at:=case when payload ? 'since' then beta_private.monitor_time(payload->>'since') else now()-interval '90 days' end;
  if before_at is null or since_at is null then raise exception 'BETA_MONITOR_INVALID';end if;
  select coalesce(jsonb_agg(n.data||jsonb_build_object('id',n.id,'createdAt',n.created_at,'readAt',n.read_at,'alertId',n.alert_id) order by n.created_at desc),'[]'::jsonb) into rows
   from (select * from public.beta_monitor_notices n where n.user_id=uid and n.created_at<before_at and n.created_at>=since_at and n.created_at>=now()-interval '90 days' and (not coalesce((payload->>'unreadOnly')::boolean,false) or n.read_at is null) order by n.created_at desc limit 51) n;
  return jsonb_build_object('unread',(select count(*) from public.beta_monitor_notices n where n.user_id=uid and n.read_at is null and n.created_at>=now()-interval '90 days'),
   'notices',case when jsonb_array_length(rows)>50 then rows-50 else rows end,'hasMore',jsonb_array_length(rows)>50,
   'alerts',coalesce((select jsonb_agg(beta_private.monitor_alert_json(a) order by a.created_at desc) from public.beta_monitor_alerts a where a.user_id=uid),'[]'::jsonb),
   'lastCollectedAt',(select max(a.collected_at) from public.beta_monitor_assets a join beta_private.monitor_subscriptions(uid) s on s.symbol=a.symbol));
 elsif operation in ('save_alert','pause_alert','delete_alert') then
  if operation='save_alert' then
   if exists(select 1 from jsonb_object_keys(payload) k where k not in ('id','revision','requestId','symbol','name','conditions','enabled'))
    or coalesce(payload->>'symbol','') !~ '^[A-Z0-9^][A-Z0-9.^=-]{0,14}$' or jsonb_typeof(payload->'name') is distinct from 'string'
    or length(btrim(payload->>'name')) not between 1 and 80 or payload->>'name' ~ '[[:cntrl:]<>]'
    or not beta_private.monitor_conditions(payload->'conditions') or jsonb_typeof(payload->'enabled') is distinct from 'boolean' then raise exception 'BETA_MONITOR_INVALID';end if;
   if not payload ? 'id' then
    if payload ? 'revision' or coalesce(payload->>'requestId','') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then raise exception 'BETA_MONITOR_INVALID';end if;
    request_key:=(payload->>'requestId')::uuid;digest:=md5((payload-'requestId')::text);
    select * into prior_request from public.beta_monitor_alert_requests r where r.user_id=uid and r.request_id=request_key;
    if found then
     if prior_request.fingerprint<>digest then raise exception 'BETA_MONITOR_CONFLICT';end if;
     select * into item from public.beta_monitor_alerts a where a.id=prior_request.alert_id and a.user_id=uid;
     if not found then raise exception 'BETA_MONITOR_NOT_FOUND';end if;
     return beta_private.monitor_alert_json(item);
    end if;
    if (select count(*) from public.beta_monitor_alert_requests r where r.user_id=uid)>=1000 then raise exception 'BETA_MONITOR_LIMIT';end if;
    if (select count(*) from public.beta_monitor_alerts a where a.user_id=uid)>=50 or (payload->>'enabled')::boolean and (select count(*) from public.beta_monitor_alerts a where a.user_id=uid and a.enabled)>=20 then raise exception 'BETA_MONITOR_LIMIT';end if;
    insert into public.beta_monitor_alerts(user_id,create_request_id,create_hash,symbol,name,conditions,enabled) values(uid,request_key,digest,payload->>'symbol',btrim(payload->>'name'),payload->'conditions',(payload->>'enabled')::boolean) returning * into item;
    insert into public.beta_monitor_alert_requests(user_id,request_id,fingerprint,alert_id) values(uid,request_key,digest,item.id);
    return beta_private.monitor_alert_json(item);
   end if;
  elsif exists(select 1 from jsonb_object_keys(payload) k where k not in ('id','revision','enabled') or (operation='delete_alert' and k='enabled')) or operation='pause_alert' and jsonb_typeof(payload->'enabled') is distinct from 'boolean' then raise exception 'BETA_MONITOR_INVALID';end if;
  if coalesce(payload->>'id','') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' or jsonb_typeof(payload->'revision') is distinct from 'number' or (payload->>'revision')::numeric<>trunc((payload->>'revision')::numeric) or (payload->>'revision')::numeric<1 then raise exception 'BETA_MONITOR_INVALID';end if;
  target:=(payload->>'id')::uuid;select * into item from public.beta_monitor_alerts a where a.id=target and a.user_id=uid for update;
  if not found then raise exception 'BETA_MONITOR_NOT_FOUND';end if;
  if item.revision<>(payload->>'revision')::numeric then raise exception 'BETA_MONITOR_CONFLICT';end if;
  if operation='delete_alert' then delete from public.beta_monitor_alerts where id=target and user_id=uid;return jsonb_build_object('ok',true);end if;
  if (payload->>'enabled')::boolean and not item.enabled and (select count(*) from public.beta_monitor_alerts a where a.user_id=uid and a.enabled)>=20 then raise exception 'BETA_MONITOR_LIMIT';end if;
  changed:=operation='save_alert' and (item.symbol is distinct from payload->>'symbol' or item.conditions is distinct from payload->'conditions');
  update public.beta_monitor_alerts a set symbol=case when operation='save_alert' then payload->>'symbol' else a.symbol end,
   name=case when operation='save_alert' then btrim(payload->>'name') else a.name end,conditions=case when operation='save_alert' then payload->'conditions' else a.conditions end,
   enabled=(payload->>'enabled')::boolean,revision=a.revision+1,updated_at=clock_timestamp(),
   last_matched=case when changed then false else a.last_matched end,last_observed_at=case when changed then null else a.last_observed_at end,evaluation=case when changed then null else a.evaluation end where a.id=target returning * into item;
  return beta_private.monitor_alert_json(item);
 elsif operation='analysis_budget' then
  if exists(select 1 from jsonb_object_keys(payload) k where k<>'count') or (payload ? 'count' and payload->'count' is distinct from '1'::jsonb) then raise exception 'BETA_MONITOR_INVALID';end if;
  perform pg_advisory_xact_lock(hashtextextended('monitor:analysis-budget',0));
  insert into public.beta_monitor_analysis_budget(day,batches) values((now() at time zone 'UTC')::date,0) on conflict(day) do nothing;
  select batches into limit_count from public.beta_monitor_analysis_budget where day=(now() at time zone 'UTC')::date for update;
  if limit_count>=96 then return jsonb_build_object('allowed',false,'remaining',0);end if;
  update public.beta_monitor_analysis_budget set batches=batches+1 where day=(now() at time zone 'UTC')::date;
  delete from public.beta_monitor_analysis_budget where day<(now() at time zone 'UTC')::date-7;
  return jsonb_build_object('allowed',true,'remaining',95-limit_count);
 elsif operation='claim_assets' then
  if exists(select 1 from jsonb_object_keys(payload) k where k<>'limit') or (payload ? 'limit' and (jsonb_typeof(payload->'limit') is distinct from 'number' or (payload->>'limit')::numeric<>trunc((payload->>'limit')::numeric) or (payload->>'limit')::numeric not between 1 and 8)) then raise exception 'BETA_MONITOR_INVALID';end if;
  max_items:=coalesce((payload->>'limit')::integer,4);
  perform pg_advisory_xact_lock(hashtextextended('monitor:claim-assets',0));
  delete from public.beta_monitor_history where observed_at<now()-interval '30 days';
  delete from public.beta_monitor_events where created_at<now()-interval '90 days';
  delete from public.beta_monitor_notices where created_at<now()-interval '90 days';
  delete from public.beta_monitor_visits where created_at<now()-interval '90 days';
  delete from public.beta_monitor_alert_requests where alert_id is null and created_at<now()-interval '90 days';
  delete from public.beta_monitor_assets a where a.updated_at<now()-interval '30 days' and not exists(select 1 from beta_private.monitor_subscriptions() s where s.symbol=a.symbol);
  insert into public.beta_monitor_assets(symbol)
   select distinct s.symbol from beta_private.monitor_subscriptions() s where not exists(select 1 from public.beta_monitor_assets a where a.symbol=s.symbol)
   order by s.symbol limit greatest(0,2048-(select count(*)::integer from public.beta_monitor_assets)) on conflict(symbol) do nothing;
  rows:='[]'::jsonb;
  for asset in select a.* from public.beta_monitor_assets a where a.due_at<=now() and (a.lease_until is null or a.lease_until<=now()) and exists(select 1 from beta_private.monitor_subscriptions() s where s.symbol=a.symbol) order by a.due_at,a.symbol limit max_items for update skip locked loop
   token:=gen_random_uuid();update public.beta_monitor_assets set lease_token=token,lease_until=now()+interval '2 minutes' where symbol=asset.symbol;
   select coalesce(jsonb_agg(beta_private.monitor_alert_json(a) order by a.updated_at),'[]'::jsonb) into config from (select a.* from public.beta_monitor_alerts a where a.symbol=asset.symbol and a.enabled and public.beta_active_user(a.user_id) order by a.updated_at limit 200) a;
   rows:=rows||jsonb_build_array(jsonb_build_object('symbol',asset.symbol,'token',token,'previous',asset.snapshot,'alerts',config));
  end loop;return rows;
 elsif operation in ('commit_asset','fail_asset') then
  if exists(select 1 from jsonb_object_keys(payload) k where k not in ('symbol','token','snapshot','changes','evaluations')) or coalesce(payload->>'symbol','') !~ '^[A-Z0-9^][A-Z0-9.^=-]{0,14}$' or coalesce(payload->>'token','') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then raise exception 'BETA_MONITOR_INVALID';end if;
  chosen:=payload->>'symbol';token:=(payload->>'token')::uuid;
  perform pg_advisory_xact_lock(hashtextextended('monitor:asset:'||chosen,0));
  select * into asset from public.beta_monitor_assets a where a.symbol=chosen for update;
  if not found then raise exception 'BETA_MONITOR_CONFLICT';end if;
  if operation='fail_asset' then
   if payload ?| array['snapshot','changes','evaluations'] then raise exception 'BETA_MONITOR_INVALID';end if;
   if asset.lease_token is distinct from token or asset.lease_until<=now() then raise exception 'BETA_MONITOR_CONFLICT';end if;
   update public.beta_monitor_assets set lease_token=null,lease_until=null,failures=least(100,failures+1),due_at=now()+least(interval '1 hour',interval '5 minutes'*power(2,least(failures,4))),updated_at=now() where symbol=chosen;
   return jsonb_build_object('ok',true);
  end if;
  digest:=md5((payload-'token')::text);
  if asset.last_commit_token=token then if asset.last_commit_hash<>digest then raise exception 'BETA_MONITOR_CONFLICT';end if;return jsonb_build_object('committed',true,'cached',true);end if;
  if asset.lease_token is distinct from token or asset.lease_until<=now() then raise exception 'BETA_MONITOR_CONFLICT';end if;
  snap:=payload->'snapshot';collected:=beta_private.monitor_time(snap->>'collectedAt');
  if jsonb_typeof(snap) is distinct from 'object' or octet_length(snap::text)>150000 or snap->'schema' is distinct from '1'::jsonb or snap->>'symbol' is distinct from chosen
   or coalesce(snap->>'kind','') not in ('stock','etf','other') or length(coalesce(snap->>'name',''))>200
   or collected is null or collected>now()+interval '1 minute' or collected<now()-interval '30 minutes' or (asset.collected_at is not null and collected<asset.collected_at)
   or jsonb_typeof(snap->'metrics') is distinct from 'object' or octet_length((snap->'metrics')::text)>20000
   or jsonb_typeof(snap->'news') is distinct from 'array' or jsonb_array_length(snap->'news')>40
   or jsonb_typeof(snap->'calendar') is distinct from 'array' or jsonb_array_length(snap->'calendar')>40
   or jsonb_typeof(snap->'coverage') is distinct from 'array' or jsonb_array_length(snap->'coverage')>40
   or (snap->'currency'<>'null'::jsonb and coalesce(snap->>'currency','') !~ '^[A-Z]{3}$')
   or jsonb_typeof(payload->'changes') is distinct from 'array' or jsonb_array_length(payload->'changes')>40
   or jsonb_typeof(payload->'evaluations') is distinct from 'array' or jsonb_array_length(payload->'evaluations')>200 then raise exception 'BETA_MONITOR_INVALID';end if;
  if snap->'holdings' is not null and snap->'holdings'<>'null'::jsonb and (jsonb_typeof(snap->'holdings')<>'object' or jsonb_typeof(snap->'holdings'->'items') is distinct from 'array' or jsonb_array_length(snap->'holdings'->'items')>100) then raise exception 'BETA_MONITOR_INVALID';end if;
  is_new:=asset.snapshot is null;
  select coalesce(array_agg(distinct s.user_id order by s.user_id),'{}'::uuid[]) into recipients from beta_private.monitor_subscriptions() s where s.symbol=chosen;
  foreach owner in array recipients loop perform pg_advisory_xact_lock(hashtextextended('monitor:'||owner::text,0));end loop;
  update public.beta_monitor_assets set snapshot=snap,collected_at=collected,due_at=now()+interval '15 minutes',lease_token=null,lease_until=null,failures=0,last_commit_token=token,last_commit_hash=digest,updated_at=now() where symbol=chosen;
  -- Hourly observations plus a daily final point bound history without copying
  -- full news/holdings. Keep the last64 points and no more than thirty days.
  insert into public.beta_monitor_history(symbol,observed_at,metrics) values(chosen,collected,snap->'metrics') on conflict(symbol,observed_at) do nothing;
  delete from public.beta_monitor_history h where h.symbol=chosen and h.id not in (
   select id from (
    (select distinct on(date_trunc('day',observed_at)) id,observed_at from public.beta_monitor_history where symbol=chosen and observed_at>=now()-interval '30 days' order by date_trunc('day',observed_at),observed_at desc)
    union
    (select id,observed_at from (select distinct on(date_trunc('hour',observed_at)) id,observed_at from public.beta_monitor_history where symbol=chosen order by date_trunc('hour',observed_at),observed_at desc) hourly order by observed_at desc limit 32)
   ) kept order by observed_at desc limit 64
  );
  for change in select v from jsonb_array_elements(payload->'changes') v loop
   occurred:=beta_private.monitor_time(change->>'occurredAt');
   if jsonb_typeof(change) is distinct from 'object' or octet_length(change::text)>12000 or length(coalesce(change->>'key','')) not between 1 and 250 or change->>'symbol' is distinct from chosen
    or coalesce(change->>'kind','') not in ('price','news','publication','estimate') or coalesce(change->>'importance','') not in ('high','medium')
    or length(coalesce(change->>'title','')) not between 1 and 300 or length(coalesce(change->>'detail',''))>7000
    or length(coalesce(change->>'source','')) not between 1 and 200 or length(coalesce(change->>'url',''))>2000
    or (change->>'url'<>'' and change->>'url' !~ '^https://[^[:space:]<>]+$') or occurred is null or occurred>now()+interval '1 minute' or occurred<now()-interval '90 days' then raise exception 'BETA_MONITOR_INVALID';end if;
   if is_new and (change->>'kind'<>'news' or occurred<now()-interval '24 hours') then continue;end if;
   insert into public.beta_monitor_events(symbol,key,data,occurred_at) values(chosen,change->>'key',change,occurred) on conflict(key) do nothing;
   foreach owner in array recipients loop
    if public.beta_active_user(owner) and exists(select 1 from beta_private.monitor_subscriptions(owner) s where s.symbol=chosen) then perform beta_private.monitor_add_notice(owner,change);end if;
   end loop;
  end loop;
  for entry in select v from jsonb_array_elements(payload->'evaluations') v loop
   if coalesce(entry->>'id','') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' or jsonb_typeof(entry->'revision') is distinct from 'number' then ignored:=ignored+1;continue;end if;
   select * into item from public.beta_monitor_alerts a where a.id=(entry->>'id')::uuid and a.symbol=chosen and a.enabled and a.revision=(entry->>'revision')::numeric and public.beta_active_user(a.user_id) for update;
   if not found then ignored:=ignored+1;continue;end if;
   evaluation:=entry->'evaluation';
   if not coalesce(beta_private.monitor_evaluation_valid(item.conditions,snap,evaluation),false) then ignored:=ignored+1;continue;end if;
   update public.beta_monitor_alerts set evaluation=entry->'evaluation',updated_at=clock_timestamp() where id=item.id;
   if evaluation->'matched'='null'::jsonb then continue;end if;
   -- Published dates may legitimately stay the same after an estimate revision
   -- or a calendar countdown. Order processing by the leased observation time;
   -- each condition still has to pass its own source-date freshness check.
   observed:=collected;
   if observed is null or item.last_observed_at is not null and observed<=item.last_observed_at then continue;end if;
   if evaluation->'matched'='true'::jsonb and not item.last_matched then
    part:=evaluation->'conditions'->0;
    select string_agg((v->'condition'->>'field')||' '||(v->'condition'->>'op')||' '||(v->'condition'->>'value')||coalesce(' '||(v->'condition'->>'currency'),'')||' · Observado: '||coalesce(v->>'value','N/D')||' · Dato: '||coalesce(v->>'asOf','Sin fecha'),E'\n') into source from jsonb_array_elements(evaluation->'conditions') v;
    change:=jsonb_build_object('key','alert:'||item.id::text||':'||item.revision::text||':'||(item.trigger_count+1)::text,'symbol',chosen,'kind','alert','title',item.name,'detail',coalesce(evaluation->>'reason','')||E'\n'||coalesce(source,''),'conditions',evaluation->'conditions','occurredAt',evaluation->>'checkedAt','source',coalesce(part->>'source','Seguimiento de condiciones'),'url',coalesce(part->>'url',''),'importance','high');
    perform beta_private.monitor_add_notice(item.user_id,change,item.id);
    update public.beta_monitor_alerts set last_notified_at=now(),trigger_count=trigger_count+1 where id=item.id;
   end if;
   update public.beta_monitor_alerts set last_matched=(entry->'evaluation'->>'matched')::boolean,last_observed_at=observed where id=item.id;
  end loop;
  delete from public.beta_monitor_events e where e.symbol=chosen and e.id not in (select id from public.beta_monitor_events where symbol=chosen order by created_at desc limit 200);
  return jsonb_build_object('committed',true,'cached',false,'ignoredEvaluations',ignored);
 elsif operation='status' then
  if payload<>'{}'::jsonb then raise exception 'BETA_MONITOR_INVALID';end if;
  return jsonb_build_object('assets',(select count(*) from public.beta_monitor_assets),'due',(select count(*) from public.beta_monitor_assets where due_at<=now()),'leased',(select count(*) from public.beta_monitor_assets where lease_until>now()),'lastCollectedAt',(select max(collected_at) from public.beta_monitor_assets),'untracked',(select count(distinct s.symbol) from beta_private.monitor_subscriptions() s where not exists(select 1 from public.beta_monitor_assets a where a.symbol=s.symbol)));
 end if;
 raise exception 'BETA_MONITOR_INVALID';
end $$;

-- Explicitly close the default PUBLIC execute privilege on every helper.
revoke all on function beta_private.monitor_time(text),beta_private.monitor_conditions(jsonb),beta_private.monitor_alert_json(public.beta_monitor_alerts),beta_private.monitor_subscriptions(uuid),beta_private.monitor_add_notice(uuid,jsonb,uuid),beta_private.monitor_evaluation_valid(jsonb,jsonb,jsonb),public.beta_monitor_store(text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.beta_monitor_store(text,uuid,jsonb) to service_role;

create function public.beta_run_monitor_schedule() returns void
language plpgsql security definer set search_path='' as $$declare credential text;begin
 if not exists(select 1 from beta_private.monitor_subscriptions() limit 1) then return;end if;
 select decrypted_secret into credential from vault.decrypted_secrets where name='terminal_brief_cron' limit 1;
 if credential is null then return;end if;
 perform net.http_post(url:='https://zeimhqybhsrmfljrdkwk.supabase.co/functions/v1/monitoring-worker',headers:=jsonb_build_object('Content-Type','application/json','x-monitor-job',credential),body:='{"operation":"run"}'::jsonb,timeout_milliseconds:=5000);
end $$;
revoke all on function public.beta_run_monitor_schedule() from public,anon,authenticated,service_role;
select cron.schedule('terminal-monitoring','*/5 * * * *','select public.beta_run_monitor_schedule();');

commit;
