begin;

create table public.beta_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  created_at timestamptz not null default now(),
  revoked boolean not null default false
);
create table public.beta_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.beta_profiles(id) on delete cascade,
  kind text not null check (kind in ('ticker','etf','sector')),
  subject text not null check (length(subject) between 1 and 80),
  payload jsonb not null check (octet_length(payload::text) <= 500000),
  saved_at timestamptz not null default now()
);
create index beta_reports_user_date on public.beta_reports(user_id,saved_at desc);
create table public.beta_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.beta_profiles(id) on delete cascade,
  kind text not null check(kind in ('ticker','etf','sector')),
  subject text not null,
  status text not null default 'started' check(status in ('started','completed','failed','cancelled')),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index beta_usage_user_date on public.beta_usage(user_id,created_at desc);
create index beta_usage_date on public.beta_usage(created_at desc);
create table public.beta_rate_buckets (
  bucket text primary key,
  count integer not null,
  expires_at timestamptz not null
);
create table public.beta_admin_audit (
  id bigint generated always as identity primary key,
  admin_id uuid not null references auth.users(id),
  target_id uuid not null references auth.users(id),
  revoked boolean not null,
  created_at timestamptz not null default now()
);

create function public.beta_sync_profile() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.beta_profiles(id,email) values(new.id,lower(new.email))
  on conflict(id) do update set email=excluded.email;
  return new;
end $$;
create trigger beta_profile_created after insert or update of email on auth.users
for each row execute function public.beta_sync_profile();
insert into public.beta_profiles(id,email) select id,lower(email) from auth.users where email is not null on conflict(id) do nothing;

create function public.beta_active_user(uid uuid) returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.beta_profiles p join auth.users u on u.id=p.id where p.id=uid and not p.revoked and u.email_confirmed_at is not null);
$$;
create function public.beta_is_admin(uid uuid) returns boolean language sql stable security definer set search_path = '' as $$
 select public.beta_active_user(uid) and exists(select 1 from auth.users where id=uid and lower(email)='linoramc@gmail.com' and email_confirmed_at is not null);
$$;

alter table public.beta_profiles enable row level security;
alter table public.beta_reports enable row level security;
alter table public.beta_usage enable row level security;
alter table public.beta_rate_buckets enable row level security;
alter table public.beta_admin_audit enable row level security;
revoke all on public.beta_profiles,public.beta_reports,public.beta_usage,public.beta_rate_buckets,public.beta_admin_audit from anon,authenticated;
grant select on public.beta_reports to authenticated;
create policy beta_own_reports on public.beta_reports for select to authenticated using(user_id=(select auth.uid()) and public.beta_active_user((select auth.uid())));
grant all on public.beta_profiles,public.beta_reports,public.beta_usage,public.beta_rate_buckets,public.beta_admin_audit to service_role;
grant usage, select on sequence public.beta_admin_audit_id_seq to service_role;

-- Atomic counters are shared by all function instances. Exceeding a limit
-- rolls back the reservation, rather than relying on a per-process cache.
create function public.beta_increment(bucket_key text, maximum integer, lifetime interval) returns void language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
 insert into public.beta_rate_buckets(bucket,count,expires_at) values(bucket_key,1,now()+lifetime)
 on conflict(bucket) do update set count=case when public.beta_rate_buckets.expires_at < now() then 1 else public.beta_rate_buckets.count+1 end,
 expires_at=case when public.beta_rate_buckets.expires_at < now() then now()+lifetime else public.beta_rate_buckets.expires_at end
 returning count into n;
 if n>maximum then raise exception 'BETA_LIMIT'; end if;
end $$;

create function public.beta_reserve(uid uuid, request_class text, report_kind text default null, report_subject text default null) returns uuid language plpgsql security definer set search_path = '' as $$
declare event_id uuid; day_key text := to_char(now() at time zone 'UTC','YYYY-MM-DD');
begin
 if not public.beta_active_user(uid) then raise exception 'BETA_REVOKED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
 perform public.beta_increment(uid||':minute',60,interval '1 minute');
 perform public.beta_increment(uid||':day:'||day_key,2000,interval '1 day');
 if request_class in ('report','expensive') then
   perform public.beta_increment('global:paid:'||day_key,1000,interval '1 day');
   perform public.beta_increment(uid||':paid:'||day_key,100,interval '1 day');
 end if;
 if request_class='report' then
   if report_kind not in ('ticker','etf','sector') or report_subject is null or length(report_subject) not between 1 and 80 then raise exception 'BETA_INVALID'; end if;
   update public.beta_usage set status='failed',finished_at=now() where user_id=uid and status='started' and created_at < now()-interval '10 minutes';
   if exists(select 1 from public.beta_usage where user_id=uid and status='started') then raise exception 'BETA_BUSY'; end if;
   perform public.beta_increment('global:reports:'||day_key,200,interval '1 day');
   perform public.beta_increment(uid||':reports:'||day_key,20,interval '1 day');
   insert into public.beta_usage(user_id,kind,subject) values(uid,report_kind,report_subject) returning id into event_id;
 end if;
 delete from public.beta_rate_buckets where expires_at < now()-interval '1 day';
 return event_id;
end $$;

create function public.beta_save_report(uid uuid, report_kind text, report_subject text, report_payload jsonb) returns public.beta_reports language plpgsql security definer set search_path = '' as $$
declare saved public.beta_reports;
begin
 if not public.beta_active_user(uid) then raise exception 'BETA_REVOKED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
 if (select count(*) from public.beta_reports where user_id=uid)>=100 then raise exception 'BETA_STORAGE_LIMIT'; end if;
 insert into public.beta_reports(user_id,kind,subject,payload) values(uid,report_kind,report_subject,report_payload) returning * into saved;
 return saved;
end $$;

create function public.beta_set_revoked(admin_uid uuid, target_uid uuid, revoke_access boolean) returns void language plpgsql security definer set search_path = '' as $$
begin
 if not public.beta_is_admin(admin_uid) or admin_uid=target_uid then raise exception 'BETA_FORBIDDEN'; end if;
 update public.beta_profiles set revoked=revoke_access where id=target_uid;
 if not found then raise exception 'BETA_NOT_FOUND'; end if;
 insert into public.beta_admin_audit(admin_id,target_id,revoked) values(admin_uid,target_uid,revoke_access);
end $$;

create function public.beta_admin_overview(admin_uid uuid, page_number integer default 0, target_uid uuid default null) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
 if not public.beta_is_admin(admin_uid) then raise exception 'BETA_FORBIDDEN'; end if;
 return jsonb_build_object(
  'totalUsers',(select count(*) from public.beta_profiles),
  'totalReports',(select count(*) from public.beta_usage),
  'users',coalesce((select jsonb_agg(row_to_json(x)) from (
   select p.id,p.email,p.created_at,p.revoked,u.email_confirmed_at is not null as confirmed,
   (select count(*) from public.beta_usage b where b.user_id=p.id) as requested,
   (select count(*) from public.beta_usage b where b.user_id=p.id and b.status='completed') as completed,
   (select count(*) from public.beta_reports b where b.user_id=p.id) as saved
   from public.beta_profiles p join auth.users u on p.id=u.id order by p.created_at desc limit 50 offset greatest(0,least(page_number,10000))*50
  ) x),'[]'::jsonb),
  'activity',coalesce((select jsonb_agg(row_to_json(x)) from (
   select b.id,p.email,b.kind,b.subject,b.status,b.created_at,b.finished_at from public.beta_usage b join public.beta_profiles p on p.id=b.user_id
   where target_uid is null or b.user_id=target_uid order by b.created_at desc limit 100
  ) x),'[]'::jsonb),
  'assets',coalesce((select jsonb_agg(row_to_json(x)) from (
   select kind,subject,count(*) as reports from public.beta_usage where target_uid is null or user_id=target_uid group by kind,subject order by count(*) desc limit 50
  ) x),'[]'::jsonb)
 );
end $$;

-- No authenticated caller may forge usage, alter roles or call administrative
-- functions directly. Only the edge function holds the service role key.
revoke all on function public.beta_sync_profile(), public.beta_active_user(uuid), public.beta_is_admin(uuid), public.beta_increment(text,integer,interval), public.beta_reserve(uuid,text,text,text), public.beta_save_report(uuid,text,text,jsonb), public.beta_set_revoked(uuid,uuid,boolean), public.beta_admin_overview(uuid,integer,uuid) from public,anon,authenticated;
grant execute on function public.beta_active_user(uuid) to authenticated;
grant execute on function public.beta_active_user(uuid),public.beta_is_admin(uuid),public.beta_reserve(uuid,text,text,text),public.beta_save_report(uuid,text,text,jsonb),public.beta_set_revoked(uuid,uuid,boolean),public.beta_admin_overview(uuid,integer,uuid) to service_role;
commit;
