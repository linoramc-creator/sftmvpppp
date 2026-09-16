begin;
create schema if not exists beta_private;
revoke all on schema beta_private from public,anon;
grant usage on schema beta_private to authenticated;
create function beta_private.active_user() returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.beta_profiles p join auth.users u on u.id=p.id where p.id=(select auth.uid()) and not p.revoked and u.email_confirmed_at is not null);
$$;
revoke all on function beta_private.active_user() from public,anon;
grant execute on function beta_private.active_user() to authenticated;
revoke execute on function public.beta_active_user(uuid) from authenticated;
alter policy beta_own_reports on public.beta_reports using(user_id=(select auth.uid()) and (select beta_private.active_user()));
commit;
