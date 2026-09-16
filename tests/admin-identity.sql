begin;
do $$ declare owner_id uuid; impostor uuid := '10000000-0000-0000-0000-000000000005'; begin
 select user_id into owner_id from beta_private.admin_users limit 1;
 if owner_id is null or not public.beta_is_admin(owner_id) then raise exception 'Pinned owner missing'; end if;
 -- Simulate the original email becoming available. No permission is inherited.
 update auth.users set email='admin-identity-fixture@example.test' where id=owner_id;
 insert into auth.users(id,email,email_confirmed_at,last_sign_in_at) values(impostor,'linoramc@gmail.com',now(),now());
 if public.beta_is_admin(impostor) then raise exception 'New account inherited administration';end if;
end $$;
set local role authenticated;
do $$ begin
 begin perform 1 from beta_private.admin_users; raise exception 'Admin allowlist exposed'; exception when insufficient_privilege then null;end;
end $$;
rollback;
select 'Pinned admin identity and private allowlist passed' as result;
