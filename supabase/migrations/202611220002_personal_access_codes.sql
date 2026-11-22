begin;
create table beta_private.access_codes(
 user_id uuid primary key references auth.users(id) on delete cascade,
 digest text not null unique check(digest~'^[a-f0-9]{64}$'),version integer not null default 1 check(version>0),
 state text not null check(state in('pending','active')),updated_at timestamptz not null default now()
);
create table beta_private.access_sessions(
 session_id uuid primary key references auth.sessions(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,version integer not null,
 expires_at timestamptz not null default now()+interval '12 hours',created_at timestamptz not null default now()
);
create index access_sessions_owner on beta_private.access_sessions(user_id);
alter table beta_private.access_codes enable row level security;
alter table beta_private.access_sessions enable row level security;
revoke all on beta_private.access_codes,beta_private.access_sessions from public,anon,authenticated,service_role;

create function public.beta_access_session(uid uuid,sid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(public.beta_active_user(uid),false) and exists(
  select 1 from beta_private.access_sessions s join beta_private.access_codes c on c.user_id=s.user_id and c.version=s.version
  join auth.sessions a on a.id=s.session_id and a.user_id=s.user_id
  where s.user_id=uid and s.session_id=sid and s.expires_at>now() and c.state='active'
 );
$$;
revoke all on function public.beta_access_session(uuid,uuid) from public,anon,authenticated;
grant execute on function public.beta_access_session(uuid,uuid) to service_role;

-- Counters commit even on a failed login; returning false never rolls them back.
create function public.beta_access_attempt(kind text,ip_hash text,code_hash text) returns boolean language plpgsql security definer set search_path='' as $$
declare entry record;n integer;allowed boolean:=true;
begin
 if current_user<>'postgres' and auth.role() is distinct from 'service_role' then raise exception 'ACCESS_FORBIDDEN';end if;
 if kind not in('login','register','bootstrap','activate','rotate','status','logout') or ip_hash!~'^[a-f0-9]{64}$' or code_hash!~'^[a-f0-9]{64}$' then raise exception 'ACCESS_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('access-rate:'||kind,0));
 for entry in select * from (values
  ('access:global:'||kind,case when kind='register' then 30 else 600 end,interval '1 minute'),
  ('access:ip:'||kind||':'||ip_hash,case when kind='register' then 4 else 20 end,interval '10 minutes'),
  ('access:key:'||kind||':'||code_hash,case when kind='register' then 4 else 10 end,interval '10 minutes')
 ) limits(bucket,maximum,lifetime) loop
  insert into public.beta_rate_buckets(bucket,count,expires_at) values(entry.bucket,1,now()+entry.lifetime)
  on conflict(bucket) do update set count=case when public.beta_rate_buckets.expires_at<now() then 1 else public.beta_rate_buckets.count+1 end,
   expires_at=case when public.beta_rate_buckets.expires_at<now() then now()+entry.lifetime else public.beta_rate_buckets.expires_at end returning count into n;
  allowed:=allowed and n<=entry.maximum;
 end loop;
 delete from public.beta_rate_buckets where bucket like 'access:%' and expires_at<now()-interval '1 day';
 return allowed;
end $$;
revoke all on function public.beta_access_attempt(text,text,text) from public,anon,authenticated;
grant execute on function public.beta_access_attempt(text,text,text) to service_role;

create function public.beta_access_store(operation text,uid uuid default null,payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare item beta_private.access_codes;session_uid uuid;sid uuid;
begin
 if current_user<>'postgres' and auth.role() is distinct from 'service_role' then raise exception 'ACCESS_FORBIDDEN';end if;
 if operation not in('find','status','prepare','activate','grant','logout') or jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>2000 then raise exception 'ACCESS_INVALID';end if;
 if operation='find' then
  if payload->>'digest'!~'^[a-f0-9]{64}$' then return null;end if;
  return (select jsonb_build_object('userId',c.user_id,'version',c.version,'state',c.state) from beta_private.access_codes c where c.digest=payload->>'digest' and public.beta_active_user(c.user_id));
 end if;
 if uid is null or not coalesce(public.beta_active_user(uid),false) then raise exception 'ACCESS_FORBIDDEN';end if;
 perform pg_advisory_xact_lock(hashtextextended('access-user:'||uid::text,0));
 select * into item from beta_private.access_codes where user_id=uid;
 if operation='status' then return jsonb_build_object('hasCode',item.user_id is not null,'pending',coalesce(item.state='pending',false));end if;
 if operation='logout' then delete from beta_private.access_sessions where user_id=uid and session_id=(payload->>'sessionId')::uuid;return '{"ok":true}';end if;
 if operation='prepare' then
  if payload->>'digest'!~'^[a-f0-9]{64}$' then raise exception 'ACCESS_INVALID';end if;
  if item.user_id is not null then
   if item.state='pending' and item.digest=payload->>'digest' then return jsonb_build_object('version',item.version);end if;
   if not public.beta_access_session(uid,(payload->>'sessionId')::uuid) then raise exception 'ACCESS_FORBIDDEN';end if;
  end if;
  insert into beta_private.access_codes(user_id,digest,state) values(uid,payload->>'digest','pending')
  on conflict(user_id) do update set digest=excluded.digest,state='pending',version=beta_private.access_codes.version+1,updated_at=clock_timestamp() returning * into item;
  delete from beta_private.access_sessions where user_id=uid;
  return jsonb_build_object('version',item.version);
 end if;
 if item.user_id is null or item.digest is distinct from payload->>'digest' or item.version::text is distinct from payload->>'version' then raise exception 'ACCESS_CHANGED';end if;
 if operation='activate' then update beta_private.access_codes set state='active' where user_id=uid;return '{"ok":true}';end if;
 if operation='grant' then
  sid:=(payload->>'sessionId')::uuid;
  if item.state<>'active' or not exists(select 1 from auth.sessions a where a.id=sid and a.user_id=uid) then raise exception 'ACCESS_FORBIDDEN';end if;
  delete from beta_private.access_sessions where user_id=uid and expires_at<=now();
  insert into beta_private.access_sessions(session_id,user_id,version) values(sid,uid,item.version)
  on conflict(session_id) do nothing;
  return '{"ok":true}';
 end if;
 raise exception 'ACCESS_INVALID';
end $$;
revoke all on function public.beta_access_store(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.beta_access_store(text,uuid,jsonb) to service_role;

-- Interactive RLS checks codes; background workers keep beta_active_user intact.
create or replace function beta_private.active_user() returns boolean language sql stable security definer set search_path='' as $$
 select public.beta_access_session((select auth.uid()),nullif((select auth.jwt())->>'session_id','')::uuid);
$$;
commit;
