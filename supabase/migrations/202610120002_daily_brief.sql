begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create table public.beta_watchlists (
 user_id uuid primary key references public.beta_profiles(id) on delete cascade,
 symbols text[] not null default '{}' check(cardinality(symbols)<=6),
 updated_at timestamptz not null default now()
);
create table public.beta_brief_settings (
 user_id uuid primary key references public.beta_profiles(id) on delete cascade,
 enabled boolean not null default false,
 email_enabled boolean not null default false
);
create table public.beta_daily_briefs (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.beta_profiles(id) on delete cascade,
 edition date not null,
 status text not null check(status in ('building','ready','failed')),
 attempts integer not null default 1 check(attempts between 1 and 3),
 payload jsonb,
 html text,
 mail_status text not null default 'pending' check(mail_status in ('pending','sending','sent','unavailable','failed','uncertain','disabled')),
 mail_id text,
 updated_at timestamptz not null default now(),
 sent_at timestamptz,
 unique(user_id,edition)
);
create index beta_briefs_user_date on public.beta_daily_briefs(user_id,edition desc);
alter table public.beta_watchlists enable row level security;
alter table public.beta_brief_settings enable row level security;
alter table public.beta_daily_briefs enable row level security;
revoke all on public.beta_watchlists,public.beta_brief_settings,public.beta_daily_briefs from public,anon,authenticated;
grant all on public.beta_watchlists,public.beta_brief_settings,public.beta_daily_briefs to service_role;

-- Pilot delivery is restricted to the existing pinned owner, never an email
-- or an administrator flag supplied by a client.
insert into public.beta_brief_settings(user_id,enabled,email_enabled)
select id,true,true from public.beta_profiles where public.beta_is_admin(id);
insert into public.beta_watchlists(user_id,symbols)
select id,array['AAPL','MSFT','NVDA'] from public.beta_profiles where public.beta_is_admin(id);
create function public.beta_claim_brief(uid uuid,edition_date date) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if not public.beta_is_admin(uid) then raise exception 'BETA_FORBIDDEN'; end if;
 insert into public.beta_daily_briefs(user_id,edition,status) values(uid,edition_date,'building')
 on conflict(user_id,edition) do update set status='building',attempts=public.beta_daily_briefs.attempts+1,updated_at=now()
 where public.beta_daily_briefs.attempts<3 and (public.beta_daily_briefs.status='failed' or (public.beta_daily_briefs.status='building' and public.beta_daily_briefs.updated_at<now()-interval '10 minutes'))
 returning id into result;
 return result;
end $$;
revoke all on function public.beta_claim_brief(uuid,date) from public,anon,authenticated;
grant execute on function public.beta_claim_brief(uuid,date) to service_role;

do $$ begin
 if not exists(select 1 from vault.secrets where name='terminal_brief_cron') then
  perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'terminal_brief_cron','Private daily brief scheduler credential');
 end if;
end $$;
create function public.beta_brief_cron_secret() returns text
language sql security definer set search_path='' as $$
 select decrypted_secret from vault.decrypted_secrets where name='terminal_brief_cron' limit 1;
$$;
revoke all on function public.beta_brief_cron_secret() from public,anon,authenticated;
grant execute on function public.beta_brief_cron_secret() to service_role;

create function public.beta_run_brief_schedule() returns void
language plpgsql security definer set search_path='' as $$
declare local_time timestamp:=now() at time zone 'Europe/Madrid';operation text;credential text;
begin
 if not exists(select 1 from public.beta_brief_settings s where s.enabled and public.beta_is_admin(s.user_id)) then return; end if;
 if extract(hour from local_time)=6 and extract(minute from local_time) in (55,58) then operation:='generate';
 elsif extract(hour from local_time)=7 and extract(minute from local_time) in (0,3,10) then operation:='deliver';
 else return; end if;
 select decrypted_secret into credential from vault.decrypted_secrets where name='terminal_brief_cron' limit 1;
 if credential is null then return; end if;
 perform net.http_post(url:='https://zeimhqybhsrmfljrdkwk.supabase.co/functions/v1/daily-brief',
  headers:=jsonb_build_object('Content-Type','application/json','x-brief-job',credential),
  body:=jsonb_build_object('operation',operation),timeout_milliseconds:=5000);
end $$;
revoke all on function public.beta_run_brief_schedule() from public,anon,authenticated;
select cron.schedule('terminal-daily-brief','* * * * *','select public.beta_run_brief_schedule();');
commit;
