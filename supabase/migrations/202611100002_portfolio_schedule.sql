begin;
-- Reuse the existing server-only Vault credential. No new client access,
-- email delivery, broker connection or real transaction is introduced.
create function public.beta_run_portfolio_schedule() returns void
language plpgsql security definer set search_path='' as $$
declare credential text; local_time timestamp;
begin
 local_time:=now() at time zone 'America/New_York';
 if extract(isodow from local_time)>5 or local_time::time<time '04:00' or local_time::time>time '20:30' then return;end if;
 -- The half hour after the session lets delayed final candles settle. The
 -- execution engine itself enforces the dated exchange calendar and sessions.
 if not exists(select 1 from public.beta_paper_portfolios p where not p.archived and public.beta_is_admin(p.user_id)
  and (jsonb_array_length(p.state->'positions')>0 or exists(select 1 from jsonb_array_elements(p.state->'orders') o where o->>'status' in ('open','partial')))) then return;end if;
 select decrypted_secret into credential from vault.decrypted_secrets where name='terminal_brief_cron' limit 1;
 if credential is null then return;end if;
 perform net.http_post(url:='https://zeimhqybhsrmfljrdkwk.supabase.co/functions/v1/portfolio-worker',
  headers:=jsonb_build_object('Content-Type','application/json','x-research-job',credential),body:='{"operation":"run"}'::jsonb,timeout_milliseconds:=5000);
end $$;
revoke all on function public.beta_run_portfolio_schedule() from public,anon,authenticated;
select cron.schedule('terminal-private-portfolio','* * * * *','select public.beta_run_portfolio_schedule();');
commit;
