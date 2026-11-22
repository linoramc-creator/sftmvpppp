begin;
-- Preserve existing long credentials solely for authenticated migration to PINs.
alter table beta_private.access_codes add column credential_kind text not null default 'legacy' check(credential_kind in('legacy','pin'));
create or replace function public.beta_access_session(uid uuid,sid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(public.beta_active_user(uid),false) and exists(
  select 1 from beta_private.access_sessions s join beta_private.access_codes c on c.user_id=s.user_id and c.version=s.version
  join auth.sessions a on a.id=s.session_id and a.user_id=s.user_id
  where s.user_id=uid and s.session_id=sid and s.expires_at>now() and c.state='active' and c.credential_kind='pin'
 );
$$;
revoke all on function public.beta_access_session(uuid,uuid) from public,anon,authenticated;
grant execute on function public.beta_access_session(uuid,uuid) to service_role;

-- Counters commit even on a failed login; returning false never rolls them back.
create or replace function public.beta_access_attempt(kind text,ip_hash text,code_hash text) returns boolean language plpgsql security definer set search_path='' as $$
declare entry record;n integer;allowed boolean:=true;
begin
 if current_user<>'postgres' and auth.role() is distinct from 'service_role' then raise exception 'ACCESS_FORBIDDEN';end if;
 if kind not in('login','legacy','register','bootstrap','activate','rotate','status','logout') or ip_hash!~'^[a-f0-9]{64}$' or code_hash!~'^[a-f0-9]{64}$' then raise exception 'ACCESS_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('access-rate:'||kind,0));
 for entry in select * from (values
  ('access:global:'||kind,case when kind='register' then 30 else 600 end,interval '1 minute'),
  ('access:ip:'||kind||':'||ip_hash,case when kind='register' then 4 else 20 end,interval '10 minutes'),
  ('access:key:'||kind||':'||code_hash,case when kind='register' then 4 when kind='login' then 5 else 10 end,case when kind='login' then interval '15 minutes' else interval '10 minutes' end),
  ('access:daily:'||kind||':'||code_hash,case when kind='login' then 25 else 10000 end,interval '1 day')
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

-- Correct entries do not exhaust the short account limit. Failed attempts
-- remain in the daily bucket; a verified success discounts only its own entry.
create function public.beta_access_login_success(uid uuid,sid uuid,account_hash text) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not public.beta_access_session(uid,sid) or coalesce(account_hash,'')!~'^[a-f0-9]{64}$' then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended('access-rate:login',0));
 delete from public.beta_rate_buckets where bucket='access:key:login:'||account_hash;
 update public.beta_rate_buckets set count=greatest(count-1,0) where bucket='access:daily:login:'||account_hash;
 return true;
end $$;
revoke all on function public.beta_access_login_success(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.beta_access_login_success(uuid,uuid,text) to service_role;

create or replace function public.beta_access_store(operation text,uid uuid default null,payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare item beta_private.access_codes;session_uid uuid;sid uuid;migrating boolean:=false;next_kind text;
begin
 if current_user<>'postgres' and auth.role() is distinct from 'service_role' then raise exception 'ACCESS_FORBIDDEN';end if;
 if operation not in('find','status','prepare','activate','grant','logout','legacyBootstrap') or jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>2000 then raise exception 'ACCESS_INVALID';end if;
 if operation='find' then
  if coalesce(payload->>'digest','')!~'^[a-f0-9]{64}$' then return null;end if;
  return (select jsonb_build_object('userId',c.user_id,'version',c.version,'state',c.state,'credentialKind',c.credential_kind) from beta_private.access_codes c where c.digest=payload->>'digest' and public.beta_active_user(c.user_id));
 end if;
 if uid is null or not coalesce(public.beta_active_user(uid),false) then raise exception 'ACCESS_FORBIDDEN';end if;
 perform pg_advisory_xact_lock(hashtextextended('access-user:'||uid::text,0));
 select * into item from beta_private.access_codes where user_id=uid;
 sid:=(payload->>'sessionId')::uuid;
 migrating:=item.credential_kind='legacy' and exists(select 1 from beta_private.access_sessions s join auth.sessions a on a.id=s.session_id and a.user_id=s.user_id where s.user_id=uid and s.session_id=sid and s.version=-item.version and s.expires_at>now());
 if operation='status' then return jsonb_build_object('hasCode',item.user_id is not null,'pending',coalesce(item.state='pending',false),'credentialKind',item.credential_kind,'canMigrate',coalesce(migrating,false));end if;
 if operation='legacyBootstrap' then
  if item.credential_kind is distinct from 'legacy' or item.digest is distinct from payload->>'digest' or item.version::text is distinct from payload->>'version' or not exists(select 1 from auth.sessions a where a.id=sid and a.user_id=uid) then raise exception 'ACCESS_FORBIDDEN';end if;
  insert into beta_private.access_sessions(session_id,user_id,version,expires_at) values(sid,uid,-item.version,now()+interval '10 minutes') on conflict(session_id) do nothing;
  return '{"ok":true}';
 end if;
 if operation='logout' then delete from beta_private.access_sessions where user_id=uid and session_id=(payload->>'sessionId')::uuid;return '{"ok":true}';end if;
 if operation='prepare' then
  next_kind:=coalesce(payload->>'credentialKind','legacy');
  if next_kind not in('pin','legacy') then raise exception 'ACCESS_INVALID';end if;
  if coalesce(payload->>'digest','')!~'^[a-f0-9]{64}$' then raise exception 'ACCESS_INVALID';end if;
  if item.user_id is not null then
   if item.state='pending' and item.digest=payload->>'digest' and item.credential_kind=next_kind then return jsonb_build_object('version',item.version);end if;
   if not public.beta_access_session(uid,sid) and not (coalesce(migrating,false) and next_kind='pin') then raise exception 'ACCESS_FORBIDDEN';end if;
  end if;
  insert into beta_private.access_codes(user_id,digest,state,credential_kind) values(uid,payload->>'digest','pending',next_kind)
  on conflict(user_id) do update set digest=excluded.digest,credential_kind=excluded.credential_kind,state='pending',version=beta_private.access_codes.version+1,updated_at=clock_timestamp() returning * into item;
  delete from beta_private.access_sessions where user_id=uid;
  return jsonb_build_object('version',item.version);
 end if;
 if item.user_id is null or item.digest is distinct from payload->>'digest' or item.version::text is distinct from payload->>'version' then raise exception 'ACCESS_CHANGED';end if;
 if operation='activate' then update beta_private.access_codes set state='active' where user_id=uid;return '{"ok":true}';end if;
 if operation='grant' then
  sid:=(payload->>'sessionId')::uuid;
  if item.state<>'active' or item.credential_kind<>'pin' or not exists(select 1 from auth.sessions a where a.id=sid and a.user_id=uid) then raise exception 'ACCESS_FORBIDDEN';end if;
  delete from beta_private.access_sessions where user_id=uid and expires_at<=now();
  insert into beta_private.access_sessions(session_id,user_id,version) values(sid,uid,item.version)
  on conflict(session_id) do nothing;
  return '{"ok":true}';
 end if;
 raise exception 'ACCESS_INVALID';
end $$;
revoke all on function public.beta_access_store(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.beta_access_store(text,uuid,jsonb) to service_role;


commit;
