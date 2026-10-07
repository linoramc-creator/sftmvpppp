begin;
create table public.beta_alerts (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.beta_profiles(id) on delete cascade,
 symbol text not null check(symbol ~ '^[A-Z0-9^][A-Z0-9.^=-]{0,14}$'),
 kind text not null check(kind in ('price_above','price_below','daily_up','daily_down','volume')),
 threshold double precision not null check(threshold>0 and threshold<1000000000),
 created_at timestamptz not null default now(),
 triggered_at timestamptz,
 observed_value double precision,
 observed_at timestamptz
);
create index beta_alerts_user on public.beta_alerts(user_id,created_at desc);
alter table public.beta_alerts enable row level security;
revoke all on public.beta_alerts from anon,authenticated;
grant all on public.beta_alerts to service_role;
create function public.beta_create_alert(uid uuid, asset text, alert_kind text, target double precision)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.beta_alerts;
begin
 if not public.beta_active_user(uid) then raise exception 'BETA_REVOKED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
 if (select count(*) from public.beta_alerts where user_id=uid)>=50 then raise exception 'BETA_LIMIT'; end if;
 if (select count(*) from public.beta_alerts where user_id=uid and triggered_at is null)>=20 then raise exception 'BETA_LIMIT'; end if;
 insert into public.beta_alerts(user_id,symbol,kind,threshold) values(uid,asset,alert_kind,target) returning * into item;
 return to_jsonb(item);
end $$;
revoke all on function public.beta_create_alert(uuid,text,text,double precision) from public,anon,authenticated;
grant execute on function public.beta_create_alert(uuid,text,text,double precision) to service_role;
commit;
