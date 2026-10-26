begin;

create table public.beta_research_items (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.beta_profiles(id) on delete cascade,
 identity text not null,kind text not null check(kind in ('ticker','etf','sector','comparison')),subject text not null check(length(subject) between 1 and 120),
 title text not null check(length(title) between 1 and 160),folder text not null default '' check(length(folder)<=80),tags text[] not null default '{}' check(cardinality(tags)<=20),
 thesis text not null default '' check(length(thesis)<=6000),risks text not null default '' check(length(risks)<=6000),invalidation text not null default '' check(length(invalidation)<=6000),notes text not null default '' check(length(notes)<=16000),
 next_review timestamptz,monitor_enabled boolean not null default false,email_enabled boolean not null default false,status text not null default 'active' check(status in ('active','archived')),
 revision integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),latest_version integer not null default 0,
 needs_review boolean not null default false,last_checked_at timestamptz,deleted_at timestamptz,
 notification_baseline jsonb check(octet_length(notification_baseline::text)<=1000000),notification_revision integer not null default 0,
 next_check_at timestamptz not null default now(),monitor_token uuid,monitor_until timestamptz,
 unique(user_id,identity),unique(id,user_id)
);
create table public.beta_research_versions (
 id uuid primary key default gen_random_uuid(),item_id uuid not null,user_id uuid not null,version integer not null check(version>0),created_at timestamptz not null default now(),
 payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=1000000),snapshot jsonb not null check(jsonb_typeof(snapshot)='object' and octet_length(snapshot::text)<=1000000),
 settings jsonb not null default '{}' check(jsonb_typeof(settings)='object' and octet_length(settings::text)<=4096),summary text check(length(summary)<=20000),summary_model text,summary_fingerprint text,
 legacy_report_id uuid unique,
 foreign key(item_id,user_id) references public.beta_research_items(id,user_id) on delete cascade,unique(item_id,version),unique(id,user_id)
);
create table public.beta_research_reviews (
 id uuid primary key default gen_random_uuid(),item_id uuid not null,user_id uuid not null,version_id uuid not null,created_at timestamptz not null default now(),observed_at timestamptz not null default now(),
 fingerprint text not null check(length(fingerprint) between 1 and 128),current_snapshot jsonb not null check(jsonb_typeof(current_snapshot)='object' and octet_length(current_snapshot::text)<=1000000),
 diff jsonb not null check(jsonb_typeof(diff)='object' and octet_length(diff::text)<=1000000),explanation text check(length(explanation)<=20000),explanation_model text,acknowledged_at timestamptz,
 foreign key(item_id,user_id) references public.beta_research_items(id,user_id) on delete cascade,foreign key(version_id,user_id) references public.beta_research_versions(id,user_id) on delete cascade,
 unique(version_id,fingerprint)
);
create table public.beta_research_requests (
 user_id uuid not null references public.beta_profiles(id) on delete cascade,request_id uuid not null,input_hash text not null check(length(input_hash)=64),
 token uuid not null default gen_random_uuid(),lease_until timestamptz not null default now()+interval '3 minutes',item_id uuid,version_id uuid,
 primary key(user_id,request_id),foreign key(version_id,user_id) references public.beta_research_versions(id,user_id) on delete cascade
);
create table public.beta_research_ai_cache (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.beta_profiles(id) on delete cascade,kind text not null check(kind in ('summary','explain')),target_id uuid not null,
 fingerprint text not null check(length(fingerprint)=64),model text not null check(length(model) between 1 and 100),status text not null check(status in ('building','ready','failed')),
 token uuid not null default gen_random_uuid(),lease_until timestamptz not null default now()+interval '3 minutes',text text check(length(text)<=20000),created_at timestamptz not null default now(),
 unique(user_id,kind,target_id,fingerprint,model)
);
create table public.beta_research_notifications (
 id uuid primary key default gen_random_uuid(),user_id uuid not null,item_id uuid not null,review_id uuid not null references public.beta_research_reviews(id) on delete cascade,
 notification_diff jsonb not null check(jsonb_typeof(notification_diff)='object' and octet_length(notification_diff::text)<=1000000),channel text not null default 'email' check(channel='email'),status text not null default 'pending' check(status in ('pending','sending','sent','failed','uncertain','disabled')),
 token uuid,lease_until timestamptz,attempts integer not null default 0,created_at timestamptz not null default now(),sent_at timestamptz,
 foreign key(item_id,user_id) references public.beta_research_items(id,user_id) on delete cascade,unique(review_id,channel)
);
create index beta_research_items_owner on public.beta_research_items(user_id,updated_at desc);
create index beta_research_due on public.beta_research_items(next_check_at) where monitor_enabled and deleted_at is null and status='active';
create index beta_research_versions_owner on public.beta_research_versions(user_id,item_id,version desc);
create index beta_research_reviews_latest on public.beta_research_reviews(user_id,item_id,version_id,created_at desc);

alter table public.beta_research_items enable row level security;
alter table public.beta_research_versions enable row level security;
alter table public.beta_research_reviews enable row level security;
alter table public.beta_research_requests enable row level security;
alter table public.beta_research_ai_cache enable row level security;
alter table public.beta_research_notifications enable row level security;
revoke all on public.beta_research_items,public.beta_research_versions,public.beta_research_reviews,public.beta_research_requests,public.beta_research_ai_cache,public.beta_research_notifications from public,anon,authenticated,service_role;
grant select on public.beta_research_items,public.beta_research_versions,public.beta_research_reviews,public.beta_research_requests,public.beta_research_ai_cache,public.beta_research_notifications to service_role;

create function public.beta_research_immutable_version() returns trigger language plpgsql set search_path='' as $$
begin
 if (to_jsonb(new)-array['summary','summary_model','summary_fingerprint']) is distinct from (to_jsonb(old)-array['summary','summary_model','summary_fingerprint']) then raise exception 'BETA_RESEARCH_IMMUTABLE';end if;
 return new;
end $$;
create trigger beta_research_version_immutable before update on public.beta_research_versions for each row execute function public.beta_research_immutable_version();
create function public.beta_research_immutable_review() returns trigger language plpgsql set search_path='' as $$
begin
 if (to_jsonb(new)-array['explanation','explanation_model','acknowledged_at','observed_at']) is distinct from (to_jsonb(old)-array['explanation','explanation_model','acknowledged_at','observed_at']) then raise exception 'BETA_RESEARCH_IMMUTABLE';end if;
 return new;
end $$;
create trigger beta_research_review_immutable before update on public.beta_research_reviews for each row execute function public.beta_research_immutable_review();

-- Import old reports without fetching current prices or changing their payload,
-- date or original row. Repeated imports are no-ops, including old clients that
-- continue to use beta_save_report after the library has launched.
create function public.beta_research_import_legacy(uid uuid) returns integer language plpgsql security definer set search_path='' as $$
declare old public.beta_reports;item public.beta_research_items;count_imported integer:=0;v integer;snap jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
 for old in select r.* from public.beta_reports r where r.user_id=uid and not exists(select 1 from public.beta_research_versions v where v.legacy_report_id=r.id) order by r.saved_at,r.id loop
  select * into item from public.beta_research_items where user_id=uid and identity=old.kind||':'||upper(trim(old.subject));
  if not found then
   if (select count(*) from public.beta_research_items where user_id=uid)>=100 then raise exception 'BETA_RESEARCH_ITEM_LIMIT';end if;
   insert into public.beta_research_items(user_id,identity,kind,subject,title,created_at,updated_at) values(uid,old.kind||':'||upper(trim(old.subject)),old.kind,trim(old.subject),trim(old.subject),old.saved_at,old.saved_at) returning * into item;
  end if;
  if (select count(*) from public.beta_research_versions where user_id=uid)>=500 then raise exception 'BETA_RESEARCH_VERSION_LIMIT';end if;
  snap=jsonb_build_object('schema',1,'kind',old.kind,'subject',old.subject,'capturedAt',old.saved_at,'quality','legacy','assets','[]'::jsonb,'metrics','[]'::jsonb,'series','[]'::jsonb,'news','[]'::jsonb,'sections',jsonb_build_array(jsonb_build_object('title','Informe archivado','text',coalesce(old.payload->>'analysis',''))),'coverage',jsonb_build_array('Archivo previo; sin captura de datos de mercado en la fecha de guardado.'),'settings','{}'::jsonb);
  v=item.latest_version+1;
  insert into public.beta_research_versions(item_id,user_id,version,created_at,payload,snapshot,settings,legacy_report_id) values(item.id,uid,v,old.saved_at,old.payload,snap,'{}',old.id);
  update public.beta_research_items set latest_version=v,created_at=least(created_at,old.saved_at),updated_at=greatest(updated_at,old.saved_at),notification_baseline=snap,notification_revision=notification_revision+1 where id=item.id;
  count_imported=count_imported+1;
 end loop;
 return count_imported;
end $$;

create function public.beta_research_list(uid uuid,include_deleted boolean default false,search_query text default '') returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(q)-array['user_id','identity','notification_baseline','notification_revision','next_check_at','monitor_token','monitor_until'] order by q.updated_at desc,q.id),'[]'::jsonb)
 from public.beta_research_items q
 where q.user_id=uid and public.beta_active_user(uid) and (include_deleted or q.deleted_at is null)
 and (coalesce(search_query,'')='' or position(lower(left(search_query,120)) in lower(concat_ws(' ',q.subject,q.title,q.folder,array_to_string(q.tags,' '),q.thesis,q.risks,q.invalidation,q.notes,(select v.payload->>'analysis' from public.beta_research_versions v where v.item_id=q.id and v.user_id=uid and v.version=q.latest_version))))>0);
$$;

-- All writes are atomic and serialized per owner. Direct table writes are not
-- granted even to the service role; clients cannot supply another owner ID.
create function public.beta_research_write(uid uuid,operation text,data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.beta_research_items;ver public.beta_research_versions;review public.beta_research_reviews;req public.beta_research_requests;job public.beta_research_ai_cache;
 target uuid;new_id uuid;v integer;input_hash text;claim uuid;
begin
 if not public.beta_active_user(uid) then raise exception 'BETA_REVOKED';end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
 if operation='claim_save' then
  perform public.beta_research_import_legacy(uid);
  select * into req from public.beta_research_requests where user_id=uid and request_id=(data->>'request_id')::uuid for update;
  if found then
   if req.input_hash<>data->>'input_hash' then raise exception 'BETA_RESEARCH_CONFLICT';end if;
   if req.version_id is not null then return jsonb_build_object('state','ready','item_id',req.item_id,'version_id',req.version_id);end if;
   if req.lease_until>now() then raise exception 'BETA_RESEARCH_BUSY';end if;
   update public.beta_research_requests set token=gen_random_uuid(),lease_until=now()+interval '3 minutes' where user_id=uid and request_id=req.request_id returning * into req;
  else
   -- Count claims too, so aborted saves cannot create an unbounded request log.
   delete from public.beta_research_requests where user_id=uid and version_id is null and lease_until<now()-interval '1 day';
   if (select count(*) from public.beta_research_requests where user_id=uid and version_id is null)>=20 then raise exception 'BETA_RESEARCH_BUSY';end if;
   if (select count(*) from public.beta_research_versions where user_id=uid)>=500 then raise exception 'BETA_RESEARCH_VERSION_LIMIT';end if;
   if exists(select 1 from public.beta_research_items where user_id=uid and identity=(data->>'kind')||':'||upper(trim(data->>'subject')) and deleted_at is not null) then raise exception 'BETA_RESEARCH_DELETED';end if;
   if (select count(*) from public.beta_research_items where user_id=uid)>=100 and not exists(select 1 from public.beta_research_items where user_id=uid and identity=(data->>'kind')||':'||upper(trim(data->>'subject'))) then raise exception 'BETA_RESEARCH_ITEM_LIMIT';end if;
   insert into public.beta_research_requests(user_id,request_id,input_hash) values(uid,(data->>'request_id')::uuid,data->>'input_hash') returning * into req;
  end if;
  return jsonb_build_object('state','claimed','token',req.token);
 end if;
 if operation='fail_save' then
  update public.beta_research_requests set lease_until=now() where user_id=uid and request_id=(data->>'request_id')::uuid and token=(data->>'token')::uuid and version_id is null;return '{}'::jsonb;
 end if;
 if operation='save' then
  select * into req from public.beta_research_requests where user_id=uid and request_id=(data->>'request_id')::uuid for update;
  if not found or req.input_hash<>data->>'input_hash' then raise exception 'BETA_RESEARCH_CONFLICT';end if;
  if req.version_id is not null then return jsonb_build_object('item_id',req.item_id,'version_id',req.version_id);end if;
  if req.token<>(data->>'token')::uuid then raise exception 'BETA_RESEARCH_CONFLICT';end if;
  if jsonb_typeof(data->'payload')<>'object' or jsonb_typeof(data->'snapshot')<>'object' or jsonb_typeof(data->'settings')<>'object' or octet_length((data->'payload')::text)>1000000 or octet_length((data->'snapshot')::text)>1000000 then raise exception 'BETA_RESEARCH_INVALID';end if;
  if data->>'item_id' is not null then select * into item from public.beta_research_items where id=(data->>'item_id')::uuid and user_id=uid;
   if not found then raise exception 'BETA_RESEARCH_NOT_FOUND';end if;
   if item.identity<>(data->>'kind')||':'||upper(trim(data->>'subject')) then raise exception 'BETA_RESEARCH_CONFLICT';end if;
  else select * into item from public.beta_research_items where user_id=uid and identity=(data->>'kind')||':'||upper(trim(data->>'subject'));
  end if;
  if item.id is null then
   if (select count(*) from public.beta_research_items where user_id=uid)>=100 then raise exception 'BETA_RESEARCH_ITEM_LIMIT';end if;
   insert into public.beta_research_items(user_id,identity,kind,subject,title) values(uid,(data->>'kind')||':'||upper(trim(data->>'subject')),data->>'kind',trim(data->>'subject'),trim(data->>'subject')) returning * into item;
  elsif item.deleted_at is not null then raise exception 'BETA_RESEARCH_DELETED';end if;
  if (select count(*) from public.beta_research_versions where user_id=uid)>=500 then raise exception 'BETA_RESEARCH_VERSION_LIMIT';end if;
  v=item.latest_version+1;
  insert into public.beta_research_versions(item_id,user_id,version,payload,snapshot,settings) values(item.id,uid,v,data->'payload',data->'snapshot',data->'settings') returning * into ver;
  update public.beta_research_items set latest_version=v,revision=revision+1,updated_at=now(),needs_review=false,last_checked_at=null,notification_baseline=ver.snapshot,notification_revision=notification_revision+1 where id=item.id;
  update public.beta_research_requests set item_id=item.id,version_id=ver.id where user_id=uid and request_id=req.request_id;
  return jsonb_build_object('item_id',item.id,'version_id',ver.id);
 end if;
 if operation in ('ai_claim','ai_finish','ai_fail') then
  if operation='ai_claim' then
   target=(data->>'target_id')::uuid;
   if data->>'kind'='summary' then select i.* into item from public.beta_research_items i join public.beta_research_versions v on v.item_id=i.id and v.user_id=i.user_id where v.id=target and i.user_id=uid;
   elsif data->>'kind'='explain' then select i.* into item from public.beta_research_items i join public.beta_research_reviews r on r.item_id=i.id and r.user_id=i.user_id where r.id=target and i.user_id=uid;
   else raise exception 'BETA_RESEARCH_INVALID';end if;
   if item.id is null then raise exception 'BETA_RESEARCH_NOT_FOUND';end if;
   if item.deleted_at is not null then raise exception 'BETA_RESEARCH_DELETED';end if;
   select * into job from public.beta_research_ai_cache where user_id=uid and kind=data->>'kind' and target_id=target and fingerprint=data->>'fingerprint' and model=data->>'model' for update;
   if found then
    if job.status='ready' then return jsonb_build_object('state','ready','text',job.text);end if;
    if job.status='building' and job.lease_until>now() then raise exception 'BETA_RESEARCH_BUSY';end if;
    update public.beta_research_ai_cache set status='building',token=gen_random_uuid(),lease_until=now()+interval '3 minutes' where id=job.id returning * into job;
   else insert into public.beta_research_ai_cache(user_id,kind,target_id,fingerprint,model,status) values(uid,data->>'kind',target,data->>'fingerprint',data->>'model','building') returning * into job;end if;
   return jsonb_build_object('state','claimed','id',job.id,'token',job.token);
  end if;
  select * into job from public.beta_research_ai_cache where id=(data->>'id')::uuid and user_id=uid and token=(data->>'token')::uuid and status='building' for update;
  if not found then raise exception 'BETA_RESEARCH_CONFLICT';end if;
  if operation='ai_fail' then update public.beta_research_ai_cache set status='failed' where id=job.id;return '{}'::jsonb;end if;
  if coalesce(length(data->>'text'),0) not between 1 and 20000 then raise exception 'BETA_RESEARCH_INVALID';end if;
  update public.beta_research_ai_cache set status='ready',text=data->>'text' where id=job.id;
  if job.kind='summary' then update public.beta_research_versions set summary=data->>'text',summary_model=job.model,summary_fingerprint=job.fingerprint where id=job.target_id and user_id=uid;
  else update public.beta_research_reviews set explanation=data->>'text',explanation_model=job.model where id=job.target_id and user_id=uid;end if;
  return '{}'::jsonb;
 end if;
 select * into item from public.beta_research_items where id=(data->>'id')::uuid and user_id=uid for update;
 if not found then raise exception 'BETA_RESEARCH_NOT_FOUND';end if;
 if operation='restore' then update public.beta_research_items set deleted_at=null,revision=revision+1,updated_at=now() where id=item.id returning * into item;
 elsif operation='delete' then update public.beta_research_items set deleted_at=coalesce(deleted_at,now()),revision=revision+1,updated_at=now(),monitor_token=null,monitor_until=null where id=item.id returning * into item;
 elsif item.deleted_at is not null then raise exception 'BETA_RESEARCH_DELETED';
 elsif operation='meta' then
  if item.revision<>(data->>'expected_revision')::integer then raise exception 'BETA_RESEARCH_CONFLICT';end if;
  update public.beta_research_items set title=case when data?'title' then data->>'title' else title end,folder=case when data?'folder' then data->>'folder' else folder end,
   tags=case when data?'tags' then array(select jsonb_array_elements_text(data->'tags')) else tags end,
   thesis=case when data?'thesis' then data->>'thesis' else thesis end,risks=case when data?'risks' then data->>'risks' else risks end,
   invalidation=case when data?'invalidation' then data->>'invalidation' else invalidation end,notes=case when data?'notes' then data->>'notes' else notes end,
   next_review=case when data?'next_review' then (data->>'next_review')::timestamptz else next_review end,
   next_check_at=case when data->>'monitor_enabled'='true' and not monitor_enabled then now() else next_check_at end,
   monitor_enabled=case when data?'monitor_enabled' then (data->>'monitor_enabled')::boolean else monitor_enabled end,
   email_enabled=case when data?'email_enabled' then (data->>'email_enabled')::boolean else email_enabled end,status=case when data?'status' then data->>'status' else status end,
   revision=revision+1,updated_at=now() where id=item.id returning * into item;
  if not item.monitor_enabled or not item.email_enabled or item.status<>'active' then update public.beta_research_notifications set status='disabled' where item_id=item.id and user_id=uid and status in ('pending','failed');end if;
 elsif operation='review' then
  select * into ver from public.beta_research_versions where id=(data->>'version_id')::uuid and item_id=item.id and user_id=uid;
  if not found then raise exception 'BETA_RESEARCH_NOT_FOUND';end if;
  if ver.version<>item.latest_version then raise exception 'BETA_RESEARCH_CONFLICT';end if;
  if item.notification_revision<>(data->>'notification_revision')::integer then raise exception 'BETA_RESEARCH_CONFLICT';end if;
  insert into public.beta_research_reviews(item_id,user_id,version_id,fingerprint,current_snapshot,diff) values(item.id,uid,ver.id,data->'diff'->>'fingerprint',data->'snapshot',data->'diff') on conflict(version_id,fingerprint) do update set observed_at=now() returning * into review;
  update public.beta_research_items set last_checked_at=now(),needs_review=coalesce((data->>'notification_material')::boolean,false) and review.acknowledged_at is null where id=item.id;
  if coalesce((data->>'notification_material')::boolean,false) and review.acknowledged_at is null and item.monitor_enabled and item.email_enabled and item.status='active' then
   insert into public.beta_research_notifications(user_id,item_id,review_id,notification_diff) values(uid,item.id,review.id,data->'notification_diff') on conflict(review_id,channel) do nothing;
   update public.beta_research_items set notification_baseline=data->'snapshot',notification_revision=notification_revision+1 where id=item.id;
  end if;
  -- Reviews are observations rather than archived reports. Keep the latest90
  -- distinct states per version; never drop unsent deliveries or versions.
  delete from public.beta_research_reviews r where r.user_id=uid and r.version_id=ver.id and r.id in(select old.id from public.beta_research_reviews old where old.version_id=ver.id order by old.observed_at desc,old.id desc offset 90) and not exists(select 1 from public.beta_research_notifications n where n.review_id=r.id and n.status in ('pending','sending'));
  delete from public.beta_research_ai_cache a where a.user_id=uid and a.kind='explain' and not exists(select 1 from public.beta_research_reviews r where r.id=a.target_id);
  return to_jsonb(review)-'user_id'-'fingerprint'-'observed_at';
 elsif operation='acknowledge' then
  update public.beta_research_reviews set acknowledged_at=coalesce(acknowledged_at,now()) where id=(data->>'review_id')::uuid and item_id=item.id and user_id=uid returning * into review;
  if not found then raise exception 'BETA_RESEARCH_NOT_FOUND';end if;
  select * into ver from public.beta_research_versions where id=review.version_id and user_id=uid;
  if ver.version=item.latest_version and review.id<>(select r.id from public.beta_research_reviews r where r.version_id=ver.id order by r.observed_at desc,r.id desc limit 1) then raise exception 'BETA_RESEARCH_CONFLICT';end if;
  if ver.version=item.latest_version then update public.beta_research_items set needs_review=false,notification_baseline=review.current_snapshot,notification_revision=notification_revision+1 where id=item.id;end if;
  update public.beta_research_notifications set status='disabled' where review_id=review.id and user_id=uid and status in ('pending','failed');
  return jsonb_build_object('item_id',item.id,'version_id',review.version_id);
 else raise exception 'BETA_RESEARCH_INVALID';end if;
 return to_jsonb(item)-array['user_id','identity','notification_baseline','notification_revision','next_check_at','monitor_token','monitor_until'];
end $$;

create function public.beta_research_claim_due(batch_size integer default 5) returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.beta_research_items;result jsonb:='[]';claim_id uuid;version_id uuid;remaining integer;bucket_key text:='research-monitor:'||to_char(now() at time zone 'UTC','YYYY-MM-DD');
begin
 perform pg_advisory_xact_lock(hashtextextended('research-monitor-quota',0));
 select 300-coalesce(max(case when expires_at>now() then count else 0 end),0) into remaining from public.beta_rate_buckets where bucket=bucket_key;
 if remaining<=0 then return result;end if;
 for item in select i.* from public.beta_research_items i where i.monitor_enabled and i.status='active' and i.deleted_at is null and i.next_check_at<=now() and (i.monitor_until is null or i.monitor_until<now()) and public.beta_active_user(i.user_id) order by i.next_check_at,i.id limit greatest(1,least(batch_size,10,remaining)) for update skip locked loop
  perform public.beta_increment(bucket_key,300,interval '1 day');
  claim_id=gen_random_uuid();select v.id into version_id from public.beta_research_versions v where v.item_id=item.id and v.user_id=item.user_id and v.version=item.latest_version;
  update public.beta_research_items set monitor_token=claim_id,monitor_until=now()+interval '15 minutes' where id=item.id;
  result=result||jsonb_build_array(jsonb_build_object('user_id',item.user_id,'item_id',item.id,'version_id',version_id,'claim_token',claim_id));
 end loop;return result;
end $$;
create function public.beta_research_complete_monitor(uid uuid,item_id uuid,claim_token uuid,next_at timestamptz default null) returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.beta_research_items set monitor_token=null,monitor_until=null,next_check_at=greatest(now()+interval '1 hour',coalesce(next_at,now()+interval '1 day')) where id=item_id and user_id=uid and monitor_token=claim_token;
 return found;
end $$;
create function public.beta_research_claim_notifications(batch_size integer default 5) returns jsonb language plpgsql security definer set search_path='' as $$
declare notice public.beta_research_notifications;result jsonb:='[]';claim_id uuid;email text;
begin
 -- A timed-out send may have reached SMTP. Never retry that ambiguous delivery.
 update public.beta_research_notifications set status='uncertain' where status='sending' and lease_until<now();
 for notice in select n.* from public.beta_research_notifications n join public.beta_research_items i on i.id=n.item_id and i.user_id=n.user_id where (n.status='pending' or n.status='failed' and n.lease_until<=now()) and n.attempts<3 and i.deleted_at is null and i.status='active' and i.monitor_enabled and i.email_enabled and public.beta_active_user(n.user_id) order by n.created_at,n.id limit greatest(1,least(batch_size,10)) for update of n skip locked loop
  claim_id=gen_random_uuid();select p.email into email from public.beta_profiles p where p.id=notice.user_id;
  update public.beta_research_notifications set status='sending',token=claim_id,lease_until=now()+interval '10 minutes',attempts=attempts+1 where id=notice.id;
  result=result||jsonb_build_array(jsonb_build_object('id',notice.id,'user_id',notice.user_id,'item_id',notice.item_id,'review_id',notice.review_id,'email',email,'claim_token',claim_id,'diff',notice.notification_diff));
 end loop;return result;
end $$;
create function public.beta_research_finish_notification(notice_id uuid,claim_token uuid,result_status text) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if result_status not in ('sent','failed','uncertain','disabled') then raise exception 'BETA_RESEARCH_INVALID';end if;
 update public.beta_research_notifications set status=result_status,sent_at=case when result_status='sent' then now() else null end,lease_until=case when result_status='failed' then now()+interval '1 hour' else lease_until end where id=notice_id and token=claim_token and status='sending';return found;
end $$;

-- Saved-report counters include library versions and any old report not yet
-- imported, without counting the same preserved legacy report twice.
create or replace function public.beta_admin_overview(admin_uid uuid,page_number integer default 0,target_uid uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.beta_is_admin(admin_uid) then raise exception 'BETA_FORBIDDEN';end if;
 return jsonb_build_object(
  'totalUsers',(select count(*) from public.beta_profiles),
  'totalReports',(select count(*) from public.beta_usage),
  'users',coalesce((select jsonb_agg(to_jsonb(x)) from(select p.id,p.email,p.created_at,p.revoked,u.email_confirmed_at is not null as confirmed,
   (select count(*) from public.beta_usage b where b.user_id=p.id) as requested,
   (select count(*) from public.beta_usage b where b.user_id=p.id and b.status='completed') as completed,
   (select count(*) from public.beta_research_versions v where v.user_id=p.id)+(select count(*) from public.beta_reports b where b.user_id=p.id and not exists(select 1 from public.beta_research_versions v where v.legacy_report_id=b.id)) as saved
   from public.beta_profiles p join auth.users u on u.id=p.id order by p.created_at desc limit 50 offset greatest(0,least(page_number,10000))*50)x),'[]'::jsonb),
  'activity',coalesce((select jsonb_agg(to_jsonb(x)) from(select b.id,p.email,b.kind,b.subject,b.status,b.created_at,b.finished_at from public.beta_usage b join public.beta_profiles p on p.id=b.user_id where target_uid is null or b.user_id=target_uid order by b.created_at desc limit 100)x),'[]'::jsonb),
  'assets',coalesce((select jsonb_agg(to_jsonb(x)) from(select kind,subject,count(*) as reports from public.beta_usage where target_uid is null or user_id=target_uid group by kind,subject order by count(*) desc limit 50)x),'[]'::jsonb)
 );
end $$;

revoke all on function public.beta_research_immutable_version(),public.beta_research_immutable_review(),public.beta_research_import_legacy(uuid),public.beta_research_list(uuid,boolean,text),public.beta_research_write(uuid,text,jsonb),public.beta_research_claim_due(integer),public.beta_research_complete_monitor(uuid,uuid,uuid,timestamptz),public.beta_research_claim_notifications(integer),public.beta_research_finish_notification(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.beta_research_import_legacy(uuid),public.beta_research_list(uuid,boolean,text),public.beta_research_write(uuid,text,jsonb),public.beta_research_claim_due(integer),public.beta_research_complete_monitor(uuid,uuid,uuid,timestamptz),public.beta_research_claim_notifications(integer),public.beta_research_finish_notification(uuid,uuid,text) to service_role;

do $$ declare uid uuid;begin for uid in select distinct user_id from public.beta_reports loop perform public.beta_research_import_legacy(uid);end loop;end $$;
commit;
