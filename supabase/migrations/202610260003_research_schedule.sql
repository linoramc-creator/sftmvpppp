begin;
-- The existing private Vault credential is shared only by server-side jobs.
-- Browser clients have no execute permission and never receive this value.
create function public.beta_run_research_schedule() returns void
language plpgsql security definer set search_path='' as $$
declare credential text;
begin
 if not exists(select 1 from public.beta_research_items i where i.monitor_enabled and i.status='active' and i.deleted_at is null and i.next_check_at<=now() and public.beta_active_user(i.user_id))
 and not exists(select 1 from public.beta_research_notifications n where n.status='pending') then return;end if;
 select decrypted_secret into credential from vault.decrypted_secrets where name='terminal_brief_cron' limit 1;
 if credential is null then return;end if;
 perform net.http_post(url:='https://zeimhqybhsrmfljrdkwk.supabase.co/functions/v1/research-monitor',
 headers:=jsonb_build_object('Content-Type','application/json','x-research-job',credential),body:='{"operation":"run"}'::jsonb,timeout_milliseconds:=5000);
end $$;
revoke all on function public.beta_run_research_schedule() from public,anon,authenticated;
select cron.schedule('terminal-research-library','*/15 * * * *','select public.beta_run_research_schedule();');
commit;
