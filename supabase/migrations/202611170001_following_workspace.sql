begin;

-- The feed list is only the initial seed. Editing Seguimiento never edits it.
create table public.beta_following_lists(
 user_id uuid primary key references public.beta_profiles(id) on delete cascade,
 symbols text[] not null default '{}',revision integer not null default 1 check(revision>0),updated_at timestamptz not null default now(),
 check(cardinality(symbols)<=7)
);
insert into public.beta_following_lists(user_id,symbols) select user_id,symbols[1:7] from public.beta_watchlists;
create table public.beta_monitor_alert_messages(
 id uuid primary key,user_id uuid not null references public.beta_profiles(id) on delete cascade,
 alert_id uuid,alert_name text not null,symbol text not null,data jsonb not null,
 conditions jsonb not null default '[]',evaluation jsonb,created_at timestamptz not null,read_at timestamptz,
 check(octet_length(data::text)<=24000),check(octet_length(conditions::text)<=10000),check(evaluation is null or octet_length(evaluation::text)<=20000)
);
create index beta_monitor_alert_messages_owner on public.beta_monitor_alert_messages(user_id,created_at desc,id desc);
create table public.beta_monitor_alert_audit(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.beta_profiles(id) on delete cascade,
 alert_id uuid not null,symbol text not null,alert_name text not null,
 action text not null check(action in ('created','edited','paused','resumed','deleted','triggered','existing')),
 at timestamptz not null default clock_timestamp(),revision integer,conditions jsonb not null default '[]',evaluation jsonb,notice_id uuid,
 check(octet_length(conditions::text)<=10000),check(evaluation is null or octet_length(evaluation::text)<=20000)
);
create index beta_monitor_alert_audit_owner on public.beta_monitor_alert_audit(user_id,at desc,id desc);
create unique index beta_monitor_alert_audit_notice on public.beta_monitor_alert_audit(user_id,notice_id) where notice_id is not null;
alter table public.beta_following_lists enable row level security;
alter table public.beta_monitor_alert_messages enable row level security;
alter table public.beta_monitor_alert_audit enable row level security;
revoke all on public.beta_following_lists,public.beta_monitor_alert_messages,public.beta_monitor_alert_audit from public,anon,authenticated,service_role;

create function beta_private.following_rule_audit() returns trigger language plpgsql security definer set search_path='' as $$
declare item public.beta_monitor_alerts;kind text;
begin
 item:=case when tg_op='DELETE' then old else new end;
 if not coalesce(public.beta_active_user(item.user_id),false) then return item;end if;
 if tg_op='INSERT' then kind:='created';
 elsif tg_op='DELETE' then kind:='deleted';
 elsif row(old.name,old.symbol,old.conditions,old.enabled) is not distinct from row(new.name,new.symbol,new.conditions,new.enabled) then return new;
 elsif old.enabled is distinct from new.enabled and row(old.name,old.symbol,old.conditions) is not distinct from row(new.name,new.symbol,new.conditions) then kind:=case when new.enabled then 'resumed' else 'paused' end;
 else kind:='edited';end if;
 insert into public.beta_monitor_alert_audit(user_id,alert_id,symbol,alert_name,action,revision,conditions)
 values(item.user_id,item.id,item.symbol,item.name,kind,item.revision,item.conditions);
 delete from public.beta_monitor_alert_audit where user_id=item.user_id and (at<now()-interval '180 days' or id in(select id from public.beta_monitor_alert_audit where user_id=item.user_id order by at desc,id desc offset 1000));
 return item;
end $$;
create trigger beta_following_rule_audit after insert or update or delete on public.beta_monitor_alerts for each row execute function beta_private.following_rule_audit();

create function beta_private.following_alert_message() returns trigger language plpgsql security definer set search_path='' as $$
declare rules jsonb;observation jsonb;
begin
 if new.alert_id is null or new.data->>'kind' is distinct from 'alert' then return new;end if;
 select coalesce(jsonb_agg(v->'condition'),'[]') into rules from jsonb_array_elements(case when jsonb_typeof(new.data->'conditions')='array' then new.data->'conditions' else '[]'::jsonb end) v;
 observation:=case when jsonb_typeof(new.data->'conditions')='array' then jsonb_build_object('status','matched','matched',true,'reason',new.data->>'detail','checkedAt',new.data->>'occurredAt','conditions',new.data->'conditions') else null end;
 insert into public.beta_monitor_alert_messages(id,user_id,alert_id,alert_name,symbol,data,conditions,evaluation,created_at,read_at)
 values(new.id,new.user_id,new.alert_id,coalesce(new.data->>'title','Alerta'),new.data->>'symbol',new.data,rules,observation,new.created_at,new.read_at) on conflict(id) do nothing;
 insert into public.beta_monitor_alert_audit(user_id,alert_id,symbol,alert_name,action,at,conditions,evaluation,notice_id)
 values(new.user_id,new.alert_id,new.data->>'symbol',coalesce(new.data->>'title','Alerta'),'triggered',new.created_at,rules,observation,new.id) on conflict(user_id,notice_id) where notice_id is not null do nothing;
 delete from public.beta_monitor_alert_messages where user_id=new.user_id and (created_at<now()-interval '180 days' or id in(select id from public.beta_monitor_alert_messages where user_id=new.user_id order by created_at desc,id desc offset 500));
 delete from public.beta_monitor_alert_audit where user_id=new.user_id and (at<now()-interval '180 days' or id in(select id from public.beta_monitor_alert_audit where user_id=new.user_id order by at desc,id desc offset 1000));
 return new;
end $$;
create trigger beta_following_alert_message after insert on public.beta_monitor_notices for each row execute function beta_private.following_alert_message();

-- Preserve already issued alerts independently from the mixed news pagination.
insert into public.beta_monitor_alert_messages(id,user_id,alert_id,alert_name,symbol,data,conditions,evaluation,created_at,read_at)
select n.id,n.user_id,n.alert_id,coalesce(n.data->>'title','Alerta'),n.data->>'symbol',n.data,
 coalesce((select jsonb_agg(v->'condition') from jsonb_array_elements(case when jsonb_typeof(n.data->'conditions')='array' then n.data->'conditions' else '[]'::jsonb end) v),'[]'),
 case when jsonb_typeof(n.data->'conditions')='array' then jsonb_build_object('status','matched','matched',true,'reason',n.data->>'detail','checkedAt',n.data->>'occurredAt','conditions',n.data->'conditions') else null end,n.created_at,n.read_at
from public.beta_monitor_notices n where n.alert_id is not null and n.data->>'kind'='alert';
insert into public.beta_monitor_alert_audit(user_id,alert_id,symbol,alert_name,action,at,conditions,evaluation,notice_id)
select user_id,alert_id,symbol,alert_name,'triggered',created_at,conditions,evaluation,id from public.beta_monitor_alert_messages;
insert into public.beta_monitor_alert_audit(user_id,alert_id,symbol,alert_name,action,revision,conditions)
select user_id,id,symbol,name,'existing',revision,conditions from public.beta_monitor_alerts;

create or replace function beta_private.monitor_subscriptions(owner uuid default null) returns table(user_id uuid,symbol text)
language sql stable security definer set search_path='' as $$
 with eligible as (select p.id from public.beta_profiles p where (owner is null or p.id=owner) and public.beta_active_user(p.id)),
 direct as (
  select w.user_id,s.symbol from public.beta_following_lists w join eligible u on u.id=w.user_id cross join lateral unnest(w.symbols) s(symbol)
  union select a.user_id,a.symbol from public.beta_monitor_alerts a join eligible u on u.id=a.user_id where a.enabled
  union select p.user_id,pos.item->>'symbol' from public.beta_paper_portfolios p join eligible u on u.id=p.user_id join auth.users au on au.id=p.user_id
   cross join lateral jsonb_array_elements(p.state->'positions') pos(item)
   where not p.archived and public.beta_is_admin(p.user_id) and lower(au.email)='linoramc@gmail.com' and au.email_confirmed_at is not null
    and case when jsonb_typeof(pos.item->'quantity')='number' then (pos.item->>'quantity')::numeric<>0 else false end
 ), indirect as (
  select d.user_id,h.item->>'symbol' as symbol from direct d join public.beta_monitor_assets a on a.symbol=d.symbol
  cross join lateral jsonb_array_elements(coalesce(nullif(a.snapshot->'holdings'->'items','null'::jsonb),'[]'::jsonb)) with ordinality h(item,n)
  where a.snapshot->>'kind'='etf' and h.n<=10 and beta_private.monitor_time(a.snapshot->'holdings'->>'asOf') between now()-interval '180 days' and now()
   and length(coalesce(a.snapshot->'holdings'->>'source',''))>0 and coalesce(a.snapshot->'holdings'->>'url','') ~ '^https://[^[:space:]<>]+$'
   and case when jsonb_typeof(h.item->'weightPct')='number' then (h.item->>'weightPct')::numeric>0 and (h.item->>'weightPct')::numeric<=100 else false end
 ) select distinct x.user_id,x.symbol from (select * from direct union all select * from indirect) x where x.symbol ~ '^[A-Z0-9^][A-Z0-9.^=-]{0,14}$';
$$;

create function public.beta_following_store(operation text,uid uuid,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare list public.beta_following_lists;chosen text[];stamp timestamptz;cursor_id uuid;rule uuid;result jsonb;last_row jsonb;more boolean;unread_count integer;
begin
 if current_user<>'postgres' and auth.role() is distinct from 'service_role' then raise exception 'BETA_MONITOR_FORBIDDEN';end if;
 if uid is null or not coalesce(public.beta_active_user(uid),false) then raise exception 'BETA_MONITOR_FORBIDDEN';end if;
 if operation not in ('watchlist','save_watchlist','state','inbox','alert_history','read') or jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>16000 then raise exception 'BETA_MONITOR_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('monitor:'||uid::text,0));
 insert into public.beta_following_lists(user_id,symbols) values(uid,coalesce((select symbols[1:7] from public.beta_watchlists where user_id=uid),'{}')) on conflict(user_id) do nothing;
 select * into list from public.beta_following_lists where user_id=uid;
 if operation in ('watchlist','state') and payload<>'{}' then raise exception 'BETA_MONITOR_INVALID';end if;
 if operation='save_watchlist' then
  if exists(select 1 from jsonb_object_keys(payload) k where k not in ('symbols','revision')) or jsonb_typeof(payload->'symbols') is distinct from 'array' or jsonb_array_length(payload->'symbols')>7 or jsonb_typeof(payload->'revision') is distinct from 'number' then raise exception 'BETA_MONITOR_INVALID';end if;
  if exists(select 1 from jsonb_array_elements(payload->'symbols') v where jsonb_typeof(v) is distinct from 'string' or v#>>'{}' !~ '^[A-Z0-9^][A-Z0-9.^=-]{0,14}$') then raise exception 'BETA_MONITOR_INVALID';end if;
  select coalesce(array_agg(v order by n),'{}') into chosen from jsonb_array_elements_text(payload->'symbols') with ordinality t(v,n);
  if cardinality(chosen)<>(select count(distinct v) from unnest(chosen) v) then raise exception 'BETA_MONITOR_INVALID';end if;
  if list.revision::numeric is distinct from (payload->>'revision')::numeric and list.symbols is distinct from chosen then raise exception 'BETA_MONITOR_CONFLICT';end if;
  if list.symbols is distinct from chosen then update public.beta_following_lists set symbols=chosen,revision=revision+1,updated_at=clock_timestamp() where user_id=uid returning * into list;end if;
 end if;
 if operation in ('watchlist','save_watchlist') then return jsonb_build_object('symbols',list.symbols,'revision',list.revision,'updatedAt',list.updated_at);end if;
 if operation='state' then
  select (select count(*) from public.beta_monitor_notices n where n.user_id=uid and n.read_at is null and n.data->>'kind'<>'alert' and n.data->>'symbol'=any(list.symbols))+(select count(*) from public.beta_monitor_alert_messages m where m.user_id=uid and m.read_at is null) into unread_count;
  return jsonb_build_object('watchlist',list.symbols,'revision',list.revision,'unread',unread_count);
 end if;
 if operation='read' then
  if exists(select 1 from jsonb_object_keys(payload) k where k<>'ids') or jsonb_typeof(payload->'ids') is distinct from 'array' or jsonb_array_length(payload->'ids') not between 1 and 100 then raise exception 'BETA_MONITOR_INVALID';end if;
  update public.beta_monitor_alert_messages set read_at=coalesce(read_at,clock_timestamp()) where user_id=uid and id in(select v::uuid from jsonb_array_elements_text(payload->'ids') v);
  return jsonb_build_object('ok',true);
 end if;
 if exists(select 1 from jsonb_object_keys(payload) k where k not in ('before','alertId','unreadOnly')) or operation='alert_history' and payload?'unreadOnly' then raise exception 'BETA_MONITOR_INVALID';end if;
 if payload?'alertId' then rule:=(payload->>'alertId')::uuid;end if;
 if payload?'unreadOnly' and jsonb_typeof(payload->'unreadOnly') is distinct from 'boolean' then raise exception 'BETA_MONITOR_INVALID';end if;
 if payload?'before' then
  if jsonb_typeof(payload->'before') is distinct from 'object' or exists(select 1 from jsonb_object_keys(payload->'before') k where k not in ('at','id')) then raise exception 'BETA_MONITOR_INVALID';end if;
  stamp:=beta_private.monitor_time(payload->'before'->>'at');cursor_id:=(payload->'before'->>'id')::uuid;
  if stamp is null or cursor_id is null then raise exception 'BETA_MONITOR_INVALID';end if;
 end if;
 if operation='inbox' then
  select count(*) into unread_count from public.beta_monitor_alert_messages where user_id=uid and read_at is null and (rule is null or alert_id=rule);
  select coalesce(jsonb_agg(v order by at desc,id desc),'[]') into result from(
   select m.created_at at,m.id,m.data||jsonb_build_object('id',m.id,'createdAt',m.created_at,'readAt',m.read_at,'alertId',m.alert_id,'alertName',m.alert_name,'conditions',m.conditions,'evaluation',m.evaluation) v
   from public.beta_monitor_alert_messages m where m.user_id=uid and (rule is null or m.alert_id=rule) and (not coalesce((payload->>'unreadOnly')::boolean,false) or m.read_at is null) and (stamp is null or (m.created_at,m.id)<(stamp,cursor_id)) order by m.created_at desc,m.id desc limit 31
  ) q;
  more:=jsonb_array_length(result)>30;result:=(select coalesce(jsonb_agg(v order by n),'[]') from jsonb_array_elements(result) with ordinality t(v,n) where n<=30);last_row:=result->(jsonb_array_length(result)-1);
  return jsonb_build_object('items',result,'unread',unread_count,'next',case when more then jsonb_build_object('at',last_row->>'createdAt','id',last_row->>'id') else null end);
 end if;
 select coalesce(jsonb_agg(v order by at desc,id desc),'[]') into result from(
  select a.at,a.id,jsonb_build_object('id',a.id,'alertId',a.alert_id,'symbol',a.symbol,'alertName',a.alert_name,'action',a.action,'at',a.at,'revision',a.revision,'conditions',a.conditions,'evaluation',a.evaluation,'noticeId',a.notice_id) v
  from public.beta_monitor_alert_audit a where a.user_id=uid and (rule is null or a.alert_id=rule) and (stamp is null or (a.at,a.id)<(stamp,cursor_id)) order by a.at desc,a.id desc limit 31
 ) q;
 more:=jsonb_array_length(result)>30;result:=(select coalesce(jsonb_agg(v order by n),'[]') from jsonb_array_elements(result) with ordinality t(v,n) where n<=30);last_row:=result->(jsonb_array_length(result)-1);
 return jsonb_build_object('items',result,'next',case when more then jsonb_build_object('at',last_row->>'at','id',last_row->>'id') else null end);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'BETA_MONITOR_INVALID';
end $$;
revoke all on function beta_private.following_rule_audit(),beta_private.following_alert_message(),public.beta_following_store(text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.beta_following_store(text,uuid,jsonb) to service_role;

-- Organizing a study reads evidence owned by this user, never uploaded results.
create function public.beta_mensorlab_source(uid uuid,run_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare evidence jsonb;
begin
 if current_user<>'postgres' and auth.role() is distinct from 'service_role' then raise exception 'BETA_LAB_FORBIDDEN';end if;
 if uid is null or not public.beta_active_user(uid) then raise exception 'BETA_LAB_FORBIDDEN';end if;
 select run into evidence from public.beta_lab_runs where id=run_id and user_id=uid and expires_at>now();
 if evidence is null then select run into evidence from public.beta_lab_snapshots where user_id=uid and run->>'runId'=run_id::text order by created_at desc limit 1;end if;
 if evidence is null then raise exception 'BETA_LAB_NOT_FOUND';end if;return evidence;
end $$;
revoke all on function public.beta_mensorlab_source(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.beta_mensorlab_source(uuid,uuid) to service_role;
commit;
