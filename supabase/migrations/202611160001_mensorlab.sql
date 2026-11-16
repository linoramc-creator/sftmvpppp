begin;

-- MensorLab contains research only. It has no FK, trigger or write path to the
-- simulator's orders, positions, cash, ledger or portfolio valuations.
create table public.beta_lab_projects(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.beta_profiles(id) on delete cascade,
 name text not null check(name=btrim(name) and length(name) between 1 and 100 and name !~ '[[:cntrl:]<>]'),
 definition jsonb not null check(jsonb_typeof(definition)='object' and definition->>'version'='1' and octet_length(definition::text)<=32000),
 revision integer not null default 1 check(revision>0),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index beta_lab_projects_owner on public.beta_lab_projects(user_id,updated_at desc);
create table public.beta_lab_snapshots(
 id uuid primary key default gen_random_uuid(),project_id uuid not null references public.beta_lab_projects(id) on delete cascade,
 user_id uuid not null references public.beta_profiles(id) on delete cascade,
 run jsonb not null check(jsonb_typeof(run)='object' and run->'definition'->>'version'='1' and octet_length(run::text)<=2000000),
 created_at timestamptz not null default now()
);
create index beta_lab_snapshots_project on public.beta_lab_snapshots(project_id,created_at desc,id desc);
create index beta_lab_snapshots_run on public.beta_lab_snapshots(user_id,((run->>'runId')));
create table public.beta_lab_runs(
 id uuid primary key,user_id uuid not null references public.beta_profiles(id) on delete cascade,
 run jsonb not null check(jsonb_typeof(run)='object' and run->>'runId'=id::text and run->'definition'->>'version'='1' and octet_length(run::text)<=2000000),
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '48 hours'
);
create index beta_lab_runs_owner on public.beta_lab_runs(user_id,created_at desc,id desc);
create table public.beta_lab_receipts(
 user_id uuid not null references public.beta_profiles(id) on delete cascade,request_id uuid not null,
 action text not null check(action in ('save','refresh','delete')),command_hash text not null,
 project_id uuid not null,created_at timestamptz not null default now(),primary key(user_id,request_id)
);
alter table public.beta_lab_projects enable row level security;
alter table public.beta_lab_snapshots enable row level security;
alter table public.beta_lab_runs enable row level security;
alter table public.beta_lab_receipts enable row level security;
revoke all on public.beta_lab_projects,public.beta_lab_snapshots,public.beta_lab_runs,public.beta_lab_receipts from public,anon,authenticated,service_role;

create function beta_private.mensorlab_project(uid uuid,pid uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',p.id,'name',p.name,'revision',p.revision,'created_at',p.created_at,'updated_at',p.updated_at,'definition',p.definition,
  'study_count',jsonb_array_length(p.definition->'studies'),
  'snapshot_count',(select count(*) from public.beta_lab_snapshots s where s.project_id=p.id and s.user_id=uid),
  'snapshots',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'created_at',s.created_at,'run',s.run) order by s.created_at desc,s.id desc) from public.beta_lab_snapshots s where s.project_id=p.id and s.user_id=uid),'[]'::jsonb))
 from public.beta_lab_projects p where p.id=pid and p.user_id=uid
$$;
revoke all on function beta_private.mensorlab_project(uuid,uuid) from public,anon,authenticated,service_role;

create function public.beta_mensorlab_store(operation text,uid uuid,payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare pid uuid;rid uuid;request uuid;signature text;receipt public.beta_lab_receipts;project public.beta_lab_projects;
 evidence jsonb;result jsonb;act text;new_snapshot uuid;
begin
 if current_user<>'postgres' and auth.role() is distinct from 'service_role' then raise exception 'BETA_LAB_FORBIDDEN';end if;
 if uid is null or not public.beta_active_user(uid) then raise exception 'BETA_LAB_FORBIDDEN';end if;
 -- JSONB adds spaces when rendered as text. The API's compact JSON limit is
 -- 1.5 MB; allow bounded serialization overhead here without truncating data.
 if operation not in ('list','open','putRun','save','refresh','delete','receipt') or jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>2100000 then raise exception 'BETA_LAB_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('mensorlab:'||uid::text,0));
 delete from public.beta_lab_runs where user_id=uid and expires_at<=now();
 delete from public.beta_lab_receipts where user_id=uid and created_at<now()-interval '30 days';
 delete from public.beta_lab_receipts where user_id=uid and request_id in (select request_id from public.beta_lab_receipts where user_id=uid order by created_at desc,request_id desc offset 200);
 if operation='list' then
  select coalesce(jsonb_agg(to_jsonb(p) order by p.updated_at desc,p.id),'[]'::jsonb) into result from
   (select p.id,p.name,p.revision,p.created_at,p.updated_at,jsonb_array_length(p.definition->'studies') study_count,(select count(*) from public.beta_lab_snapshots s where s.project_id=p.id and s.user_id=uid) snapshot_count from public.beta_lab_projects p where p.user_id=uid order by p.updated_at desc,p.id limit 20) p;
  return result;
 end if;
 if operation='putRun' then
  evidence:=payload->'run';rid:=(evidence->>'runId')::uuid;
  if rid is null or jsonb_typeof(evidence) is distinct from 'object' or evidence->'definition'->>'version' is distinct from '1'
   or jsonb_typeof(evidence->'definition'->'studies') is distinct from 'array' or jsonb_array_length(evidence->'definition'->'studies') not between 1 and 6
   or jsonb_typeof(evidence->'results') is distinct from 'array' or octet_length(evidence::text)>2000000 then raise exception 'BETA_LAB_INVALID';end if;
  insert into public.beta_lab_runs(id,user_id,run) values(rid,uid,evidence);
  delete from public.beta_lab_runs where user_id=uid and id in (select id from public.beta_lab_runs where user_id=uid order by created_at desc,id desc offset 10);
  return jsonb_build_object('runId',rid);
 end if;
 pid:=(payload->>'id')::uuid;
 if operation='open' then
  result:=beta_private.mensorlab_project(uid,pid);if result is null then raise exception 'BETA_LAB_NOT_FOUND';end if;
  if payload ? 'snapshotId' and not exists(select 1 from public.beta_lab_snapshots where id=(payload->>'snapshotId')::uuid and project_id=pid and user_id=uid) then raise exception 'BETA_LAB_NOT_FOUND';end if;
  return result;
 end if;
 act:=case when operation='receipt' then payload->>'action' else operation end;
 if act not in ('save','refresh','delete') then raise exception 'BETA_LAB_INVALID';end if;
 request:=(payload->>'requestId')::uuid;
 if act in ('save','refresh') and request is null then raise exception 'BETA_LAB_INVALID';end if;
 signature:=md5(act||jsonb_build_object('id',payload->'id','revision',payload->'revision',
  'name',case when act='save' then to_jsonb(btrim(payload->>'name')) else null end,
  'runId',case when act='save' then payload->'runId' else null end)::text);
 if request is not null then
  select * into receipt from public.beta_lab_receipts where user_id=uid and request_id=request;
  if found then
   if receipt.action<>act or receipt.command_hash<>signature then raise exception 'BETA_LAB_CONFLICT';end if;
   if act='delete' then return jsonb_build_object('ok',true);end if;
   result:=beta_private.mensorlab_project(uid,receipt.project_id);if result is null then raise exception 'BETA_LAB_NOT_FOUND';end if;
   return result;
  end if;
 end if;
 if operation='receipt' then return null;end if;
 if pid is not null then
  select * into project from public.beta_lab_projects where id=pid and user_id=uid for update;
  if not found then raise exception 'BETA_LAB_NOT_FOUND';end if;
  if project.revision is distinct from (payload->>'revision')::integer then raise exception 'BETA_LAB_CONFLICT';end if;
 elsif operation<>'save' then raise exception 'BETA_LAB_INVALID';end if;
 if operation='delete' then
  delete from public.beta_lab_projects where id=pid and user_id=uid;
  if request is not null then insert into public.beta_lab_receipts values(uid,request,'delete',signature,pid,now());end if;
  return jsonb_build_object('ok',true);
 end if;
 if operation='save' then
  if jsonb_typeof(payload->'name') is distinct from 'string' or length(btrim(payload->>'name')) not between 1 and 100 or payload->>'name' ~ '[[:cntrl:]<>]' then raise exception 'BETA_LAB_INVALID';end if;
  rid:=(payload->>'runId')::uuid;
  select run into evidence from public.beta_lab_runs where id=rid and user_id=uid and expires_at>now();
  if evidence is null then select s.run into evidence from public.beta_lab_snapshots s join public.beta_lab_projects p on p.id=s.project_id and p.user_id=uid where s.user_id=uid and s.run->>'runId'=rid::text order by s.created_at desc,s.id desc limit 1;end if;
  if evidence is null then raise exception 'BETA_LAB_RUN_EXPIRED';end if;
 else
  evidence:=payload->'run';rid:=(evidence->>'runId')::uuid;
  if rid is null or jsonb_typeof(evidence) is distinct from 'object' or evidence->'definition' is distinct from project.definition or jsonb_typeof(evidence->'results') is distinct from 'array' or octet_length(evidence::text)>2000000 then raise exception 'BETA_LAB_INVALID';end if;
 end if;
 if pid is null then
  if (select count(*) from public.beta_lab_projects where user_id=uid)>=20 then raise exception 'BETA_LAB_LIMIT';end if;
  insert into public.beta_lab_projects(user_id,name,definition) values(uid,btrim(payload->>'name'),evidence->'definition') returning * into project;pid:=project.id;
 else
  update public.beta_lab_projects set name=case when operation='save' then btrim(payload->>'name') else name end,definition=evidence->'definition',revision=revision+1,updated_at=now() where id=pid and user_id=uid returning * into project;
 end if;
 if operation='refresh' or (select s.run->>'runId' from public.beta_lab_snapshots s where s.project_id=pid and s.user_id=uid order by s.created_at desc,s.id desc limit 1) is distinct from rid::text then
  insert into public.beta_lab_snapshots(project_id,user_id,run) values(pid,uid,evidence) returning id into new_snapshot;
 end if;
 delete from public.beta_lab_snapshots where project_id=pid and user_id=uid and id in (select id from public.beta_lab_snapshots where project_id=pid and user_id=uid order by created_at desc,id desc offset 10);
 insert into public.beta_lab_receipts values(uid,request,operation,signature,pid,now());
 return beta_private.mensorlab_project(uid,pid);
end $$;
revoke all on function public.beta_mensorlab_store(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.beta_mensorlab_store(text,uuid,jsonb) to service_role;
commit;
