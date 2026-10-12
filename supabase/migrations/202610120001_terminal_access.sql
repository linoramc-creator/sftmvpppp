begin;
create table public.beta_terminal_access (
 id bigint generated always as identity primary key,
 user_id uuid not null references public.beta_profiles(id) on delete cascade,
 visit_id uuid not null,
 created_at timestamptz not null default now(),
 unique(user_id,visit_id)
);
create index beta_terminal_access_date on public.beta_terminal_access(created_at desc);
create index beta_terminal_access_user on public.beta_terminal_access(user_id,created_at desc);
alter table public.beta_terminal_access enable row level security;
revoke all on public.beta_terminal_access from public,anon,authenticated;
grant all on public.beta_terminal_access to service_role;
grant usage,select on sequence public.beta_terminal_access_id_seq to service_role;
create function public.beta_access_overview(admin_uid uuid, page_number integer default 0, target_uid uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.beta_is_admin(admin_uid) then raise exception 'BETA_FORBIDDEN'; end if;
 return jsonb_build_object(
 'total',(select count(*) from public.beta_terminal_access where target_uid is null or user_id=target_uid),
 'today',(select count(*) from public.beta_terminal_access where created_at>=now()-interval '24 hours' and (target_uid is null or user_id=target_uid)),
 'uniqueToday',(select count(distinct user_id) from public.beta_terminal_access where created_at>=now()-interval '24 hours' and (target_uid is null or user_id=target_uid)),
 'entries',coalesce((select jsonb_agg(to_jsonb(t)) from (
 select a.id,p.email,a.created_at from public.beta_terminal_access a join public.beta_profiles p on p.id=a.user_id
 where target_uid is null or a.user_id=target_uid order by a.created_at desc,a.id desc limit 50 offset greatest(0,least(10000,page_number))*50
 ) t),'[]'::jsonb));
end $$;
revoke all on function public.beta_access_overview(uuid,integer,uuid) from public,anon,authenticated;
grant execute on function public.beta_access_overview(uuid,integer,uuid) to service_role;
commit;
