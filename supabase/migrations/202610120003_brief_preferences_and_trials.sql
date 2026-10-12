begin;
alter table public.beta_brief_settings add column delivery_time time(0) not null default '07:00';
alter table public.beta_daily_briefs add column kind text not null default 'daily' check(kind in ('daily','test'));
alter table public.beta_daily_briefs add column request_id uuid;
alter table public.beta_daily_briefs add column created_at timestamptz not null default now();
update public.beta_daily_briefs set kind='test' where payload->>'preview'='true';
alter table public.beta_daily_briefs drop constraint beta_daily_briefs_user_id_edition_key;
create unique index beta_brief_daily_unique on public.beta_daily_briefs(user_id,edition) where kind='daily';
create unique index beta_brief_request_unique on public.beta_daily_briefs(user_id,request_id) where request_id is not null;

create or replace function public.beta_claim_brief(uid uuid,edition_date date) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if not public.beta_is_admin(uid) then raise exception 'BETA_FORBIDDEN'; end if;
 insert into public.beta_daily_briefs(user_id,edition,status,kind) values(uid,edition_date,'building','daily')
 on conflict(user_id,edition) where kind='daily' do update set status='building',attempts=public.beta_daily_briefs.attempts+1,updated_at=now()
 where public.beta_daily_briefs.attempts<3 and (public.beta_daily_briefs.status='failed' or (public.beta_daily_briefs.status='building' and public.beta_daily_briefs.updated_at<now()-interval '10 minutes'))
 returning id into result;
 return result;
end $$;

create function public.beta_claim_brief_test(uid uuid,request uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid;today date:=(now() at time zone 'Europe/Madrid')::date;
begin
 if not public.beta_is_admin(uid) then raise exception 'BETA_FORBIDDEN'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text||':brief-test',0));
 if exists(select 1 from public.beta_daily_briefs where user_id=uid and request_id=request) then return null; end if;
 if exists(select 1 from public.beta_daily_briefs where user_id=uid and kind='test' and status='building' and updated_at>now()-interval '10 minutes') then raise exception 'BRIEF_BUSY'; end if;
 if (select count(*) from public.beta_daily_briefs where user_id=uid and kind='test' and edition=today)>=5 then raise exception 'BRIEF_TEST_LIMIT'; end if;
 insert into public.beta_daily_briefs(user_id,edition,status,kind,request_id) values(uid,today,'building','test',request) returning id into result;
 return result;
end $$;
revoke all on function public.beta_claim_brief_test(uuid,uuid) from public,anon,authenticated;
grant execute on function public.beta_claim_brief_test(uuid,uuid) to service_role;

create or replace function public.beta_run_brief_schedule() returns void
language plpgsql security definer set search_path='' as $$
declare task record;operation text;credential text;current_minute timestamptz:=date_trunc('minute',now());today date:=(now() at time zone 'Europe/Madrid')::date;
begin
 select decrypted_secret into credential from vault.decrypted_secrets where name='terminal_brief_cron' limit 1;
 if credential is null then return; end if;
 for task in select s.user_id,today+d.offset_days as edition,((today+d.offset_days)+s.delivery_time) at time zone 'Europe/Madrid' as due
  from public.beta_brief_settings s cross join (values(-1),(0),(1)) d(offset_days)
  where s.enabled and public.beta_is_admin(s.user_id)
 loop
  operation:=null;
  if current_minute in (task.due-interval '5 minutes',task.due-interval '2 minutes') then operation:='generate';
  elsif current_minute in (task.due,task.due+interval '3 minutes',task.due+interval '10 minutes') then operation:='deliver'; end if;
  if operation is not null then
   perform net.http_post(url:='https://zeimhqybhsrmfljrdkwk.supabase.co/functions/v1/daily-brief',
    headers:=jsonb_build_object('Content-Type','application/json','x-brief-job',credential),
    body:=jsonb_build_object('operation',operation,'userId',task.user_id,'date',task.edition),timeout_milliseconds:=5000);
  end if;
 end loop;
end $$;
commit;
