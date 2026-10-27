begin;

-- Derived readings are stored separately from each immutable original report.
alter table public.beta_research_versions add column summary_recipe text check(length(summary_recipe)<=80);

create or replace function public.beta_research_immutable_version() returns trigger language plpgsql set search_path='' as $$
begin
 if (to_jsonb(new)-array['summary','summary_model','summary_fingerprint','summary_recipe']) is distinct from (to_jsonb(old)-array['summary','summary_model','summary_fingerprint','summary_recipe']) then raise exception 'BETA_RESEARCH_IMMUTABLE';end if;
 return new;
end $$;
update public.beta_research_versions set summary_recipe='summary-v1' where summary is not null;

alter table public.beta_research_ai_cache drop constraint beta_research_ai_cache_kind_check;
alter table public.beta_research_ai_cache add constraint beta_research_ai_cache_kind_check check(kind in ('summary','explain','assessment'));
alter table public.beta_research_ai_cache add column recipe text not null default 'legacy-v1' check(length(recipe) between 1 and 80);
alter table public.beta_research_ai_cache add column assessment jsonb check(assessment is null or jsonb_typeof(assessment)='object' and octet_length(assessment::text)<=128000);
alter table public.beta_research_ai_cache add column finished_at timestamptz;

create table public.beta_research_assessments (
 id uuid primary key default gen_random_uuid(),user_id uuid not null, item_id uuid not null,version_id uuid not null,
 model text not null check(length(model) between 1 and 100),recipe text not null check(length(recipe) between 1 and 80),
 input_fingerprint text not null check(length(input_fingerprint)=64),created_at timestamptz not null default now(),
 assessment jsonb not null check(jsonb_typeof(assessment)='object' and octet_length(assessment::text)<=128000),
 current_snapshot jsonb not null check(jsonb_typeof(current_snapshot)='object' and octet_length(current_snapshot::text)<=1000000),
 foreign key(item_id,user_id) references public.beta_research_items(id,user_id) on delete cascade,
 foreign key(version_id,user_id) references public.beta_research_versions(id,user_id) on delete cascade,
 unique(version_id,model,recipe)
);
create index beta_research_assessments_owner on public.beta_research_assessments(user_id,item_id,version_id);
alter table public.beta_research_assessments enable row level security;
revoke all on public.beta_research_assessments from public,anon,authenticated,service_role;
grant select on public.beta_research_assessments to service_role;

-- Preserve all existing transactional operations while replacing only the
-- derived-output protocol. The base function remains inaccessible to clients.
alter function public.beta_research_write(uuid,text,jsonb) rename to beta_research_write_base;
revoke all on function public.beta_research_write_base(uuid,text,jsonb) from public,anon,authenticated,service_role;

create function public.beta_research_write(uid uuid,operation text,data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.beta_research_items;ver public.beta_research_versions;job public.beta_research_ai_cache;target uuid;requested_recipe text;
begin
 if operation not in ('ai_claim','ai_finish','ai_fail') then return public.beta_research_write_base(uid,operation,data);end if;
 if not public.beta_active_user(uid) then raise exception 'BETA_REVOKED';end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
 if operation='ai_claim' then
  target=(data->>'target_id')::uuid;
  if data->>'kind' in ('summary','assessment') then
   select i.* into item from public.beta_research_items i join public.beta_research_versions v on v.item_id=i.id and v.user_id=i.user_id where v.id=target and i.user_id=uid;
  elsif data->>'kind'='explain' then
   select i.* into item from public.beta_research_items i join public.beta_research_reviews r on r.item_id=i.id and r.user_id=i.user_id where r.id=target and i.user_id=uid;
  else raise exception 'BETA_RESEARCH_INVALID';end if;
  if item.id is null then raise exception 'BETA_RESEARCH_NOT_FOUND';end if;
  if item.deleted_at is not null then raise exception 'BETA_RESEARCH_DELETED';end if;
  requested_recipe=coalesce(data->>'recipe',case when data->>'kind'='summary' then 'summary-v1' else 'explain-v1' end);
  if length(requested_recipe) not between 1 and 80 or coalesce(length(data->>'fingerprint'),0)<>64 or coalesce(length(data->>'model'),0) not between 1 and 100 then raise exception 'BETA_RESEARCH_INVALID';end if;
  select * into job from public.beta_research_ai_cache where user_id=uid and kind=data->>'kind' and target_id=target and fingerprint=data->>'fingerprint' and model=data->>'model' for update;
  if found then
   if job.recipe<>requested_recipe then raise exception 'BETA_RESEARCH_CONFLICT';end if;
   if job.status='ready' and (job.kind<>'assessment' or job.finished_at>now()-interval '24 hours') then
    return jsonb_build_object('state','ready','text',job.text,'assessment',job.assessment);
   end if;
   if job.status='building' and job.lease_until>now() then raise exception 'BETA_RESEARCH_BUSY';end if;
   update public.beta_research_ai_cache set status='building',token=gen_random_uuid(),lease_until=now()+interval '3 minutes' where id=job.id returning * into job;
  else
   insert into public.beta_research_ai_cache(user_id,kind,target_id,fingerprint,model,recipe,status) values(uid,data->>'kind',target,data->>'fingerprint',data->>'model',requested_recipe,'building') returning * into job;
  end if;
  return jsonb_build_object('state','claimed','id',job.id,'token',job.token);
 end if;

 select * into job from public.beta_research_ai_cache where id=(data->>'id')::uuid and user_id=uid and token=(data->>'token')::uuid and status='building' and lease_until>now() for update;
 if not found then raise exception 'BETA_RESEARCH_CONFLICT';end if;
 if operation='ai_fail' then update public.beta_research_ai_cache set status='failed' where id=job.id;return '{}'::jsonb;end if;
 -- Account revocation, deletion and ownership are checked again after model IO.
 if job.kind in ('summary','assessment') then
  select v.* into ver from public.beta_research_versions v where v.id=job.target_id and v.user_id=uid;
  select * into item from public.beta_research_items where id=ver.item_id and user_id=uid;
 else
  select i.* into item from public.beta_research_items i join public.beta_research_reviews r on r.item_id=i.id and r.user_id=i.user_id where r.id=job.target_id and i.user_id=uid;
 end if;
 if item.id is null then raise exception 'BETA_RESEARCH_NOT_FOUND';end if;
 if item.deleted_at is not null then raise exception 'BETA_RESEARCH_DELETED';end if;
 if job.kind='assessment' then
  if coalesce(jsonb_typeof(data->'assessment'),'')<>'object' or coalesce(jsonb_typeof(data->'current_snapshot'),'')<>'object'
   or octet_length((data->'assessment')::text)>128000 or octet_length((data->'current_snapshot')::text)>1000000
   or coalesce(length(data->>'input_fingerprint'),0)<>64
   or (data->'assessment'->>'versionId') is distinct from ver.id::text or (data->'assessment'->>'model') is distinct from job.model or (data->'assessment'->>'recipe') is distinct from job.recipe
   or coalesce(data->'assessment'->>'schema','')<>'1' or coalesce(data->'assessment'->>'quality','') not in ('complete','partial','insufficient')
   or coalesce(data->'assessment'->>'asOf','')='' or (data->'assessment'->>'asOf') is distinct from (data->'current_snapshot'->>'capturedAt')
   or (data->'current_snapshot'->>'subject') is distinct from item.subject or (data->'current_snapshot'->>'kind') is distinct from item.kind
   or (data->'assessment'->>'originalAt')::timestamptz is distinct from ver.created_at
   then raise exception 'BETA_RESEARCH_INVALID';end if;
  insert into public.beta_research_assessments(user_id,item_id,version_id,model,recipe,input_fingerprint,assessment,current_snapshot)
   values(uid,item.id,ver.id,job.model,job.recipe,data->>'input_fingerprint',data->'assessment',data->'current_snapshot')
   on conflict(version_id,model,recipe) do update set input_fingerprint=excluded.input_fingerprint,assessment=excluded.assessment,current_snapshot=excluded.current_snapshot,created_at=now();
  update public.beta_research_ai_cache set status='ready',assessment=data->'assessment',finished_at=now() where id=job.id;
 else
  if coalesce(length(data->>'text'),0) not between 1 and 20000 then raise exception 'BETA_RESEARCH_INVALID';end if;
  update public.beta_research_ai_cache set status='ready',text=data->>'text',finished_at=now() where id=job.id;
  if job.kind='summary' then update public.beta_research_versions set summary=data->>'text',summary_model=job.model,summary_fingerprint=job.fingerprint,summary_recipe=job.recipe where id=job.target_id and user_id=uid;
  else update public.beta_research_reviews set explanation=data->>'text',explanation_model=job.model where id=job.target_id and user_id=uid;end if;
 end if;
 return '{}'::jsonb;
end $$;
revoke all on function public.beta_research_write(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.beta_research_write(uuid,text,jsonb) to service_role;
commit;
