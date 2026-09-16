begin;
-- Capture the existing verified owner BEFORE enabling unverified signups.
-- Future accounts never acquire administration by claiming an email address.
create table beta_private.admin_users (
 user_id uuid primary key references auth.users(id) on delete cascade
);
revoke all on beta_private.admin_users from public,anon,authenticated;
grant all on beta_private.admin_users to service_role;
insert into beta_private.admin_users(user_id)
select id from auth.users where lower(email)='linoramc@gmail.com'
and email_confirmed_at is not null and last_sign_in_at is not null;
create or replace function public.beta_is_admin(uid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.beta_active_user(uid) and exists(
 select 1 from beta_private.admin_users a join auth.users u on u.id=a.user_id
 where a.user_id=uid and lower(u.email)='linoramc@gmail.com');
$$;
revoke all on function public.beta_is_admin(uuid) from public,anon,authenticated;
grant execute on function public.beta_is_admin(uuid) to service_role;
commit;
