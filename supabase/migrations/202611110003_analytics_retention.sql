begin;

-- Compact retry receipts have a bounded lifetime and never retain deleted
-- financial definitions as a second, unlimited archive.
create function beta_private.analytics_compact_delete() returns trigger
language plpgsql set search_path='' as $$
begin
 if old.deleted_at is null and new.deleted_at is not null then
  new.name:='Consulta eliminada';new.query:='{"version":1}'::jsonb;
 end if;
 return new;
end $$;
create trigger beta_analytics_compact_delete before update of deleted_at on public.beta_analytics_queries for each row execute function beta_private.analytics_compact_delete();

create function beta_private.analytics_prune_receipts() returns trigger
language plpgsql set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('analytics:'||new.user_id::text,0));
 delete from public.beta_analytics_queries where user_id=new.user_id and deleted_at<now()-interval '30 days';
 delete from public.beta_analytics_queries where user_id=new.user_id and deleted_at is not null and id not in
  (select id from public.beta_analytics_queries where user_id=new.user_id and deleted_at is not null order by deleted_at desc,id limit 500);
 return new;
end $$;
create trigger beta_analytics_prune_receipts after insert or update of deleted_at on public.beta_analytics_queries for each row execute function beta_private.analytics_prune_receipts();
revoke all on function beta_private.analytics_compact_delete() from public,anon,authenticated;
revoke all on function beta_private.analytics_prune_receipts() from public,anon,authenticated;

update public.beta_analytics_queries set name='Consulta eliminada',query='{"version":1}'::jsonb where deleted_at is not null;

commit;
