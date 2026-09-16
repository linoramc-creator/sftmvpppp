-- Run with supabase db query --linked --file tests/beta-database.sql.
-- Every fixture and mutation is rolled back. No messages are sent.
begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('10000000-0000-0000-0000-000000000001','beta-test-one@example.test',now()),
 ('10000000-0000-0000-0000-000000000002','beta-test-two@example.test',now()),
 ('10000000-0000-0000-0000-000000000003','beta-unverified@example.test',null);
do $$
declare event_test_id uuid; total integer;
begin
 if public.beta_active_user('10000000-0000-0000-0000-000000000003') then raise exception 'Unverified account allowed'; end if;
 if public.beta_is_admin('10000000-0000-0000-0000-000000000001') then raise exception 'Role escalation'; end if;
 perform public.beta_save_report('10000000-0000-0000-0000-000000000001','ticker','AAPL','{"analysis":"Private report","quarterlyData":[]}'::jsonb);
 event_test_id:=public.beta_reserve('10000000-0000-0000-0000-000000000001','report','ticker','AAPL');
 begin
  perform public.beta_reserve('10000000-0000-0000-0000-000000000001','report','ticker','MSFT');
  raise exception 'Concurrent reports allowed';
 exception when others then if sqlerrm not like '%BETA_BUSY%' then raise; end if; end;
 update public.beta_usage set status='completed' where public.beta_usage.id=event_test_id;
 for total in 2..20 loop
  event_test_id:=public.beta_reserve('10000000-0000-0000-0000-000000000001','report','ticker','AAPL');
  update public.beta_usage set status='completed' where public.beta_usage.id=event_test_id;
 end loop;
 begin
  perform public.beta_reserve('10000000-0000-0000-0000-000000000001','report','ticker','AAPL');
  raise exception 'Daily quota bypassed';
 exception when others then if sqlerrm not like '%BETA_LIMIT%' then raise; end if; end;
 begin
  perform public.beta_set_revoked('10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',true);
  raise exception 'Non-admin revoked a user';
 exception when others then if sqlerrm not like '%BETA_FORBIDDEN%' then raise; end if; end;
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
do $$ begin
 if exists(select 1 from public.beta_reports) then raise exception 'Cross-account report access'; end if;
 begin
  perform public.beta_reserve('10000000-0000-0000-0000-000000000002','report','ticker','AAPL');
  raise exception 'Direct quota RPC permitted';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
do $$ begin if (select count(*) from public.beta_reports)<>1 then raise exception 'Owner cannot access own report';end if;end $$;
reset role;
update public.beta_profiles set revoked=true where id='10000000-0000-0000-0000-000000000001';
set local role authenticated;
do $$ begin if exists(select 1 from public.beta_reports) then raise exception 'Revoked account can read reports';end if;end $$;
reset role;
do $$ begin
 if not exists(select 1 from auth.users where lower(email)='linoramc@gmail.com') then
  insert into auth.users(id,email,email_confirmed_at) values('10000000-0000-0000-0000-000000000004','linoramc@gmail.com',now());
  if not public.beta_is_admin('10000000-0000-0000-0000-000000000004') then raise exception 'Owner admin role missing';end if;
  perform public.beta_set_revoked('10000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000002',true);
  if public.beta_active_user('10000000-0000-0000-0000-000000000002') then raise exception 'Admin revocation failed';end if;
  perform public.beta_set_revoked('10000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000002',false);
  if not public.beta_active_user('10000000-0000-0000-0000-000000000002') then raise exception 'Admin restore failed';end if;
  if jsonb_array_length(public.beta_admin_overview('10000000-0000-0000-0000-000000000004')->'activity')<20 then raise exception 'Admin activity missing';end if;
 end if;
end $$;
rollback;
select 'RLS, verification, isolation, revocation, concurrency and daily quota: passed' as result;
