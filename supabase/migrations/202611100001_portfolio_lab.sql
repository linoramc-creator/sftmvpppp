begin;

-- Private paper trading only. Neither client JWTs nor the service API may read
-- or write this table directly: all access goes through the guarded RPC below.
create table public.beta_paper_portfolios (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.beta_profiles(id) on delete cascade,
 creation_key uuid not null,
 creation_hash text not null check (creation_hash ~ '^[a-f0-9]{32}$'),
 name text not null check (name=btrim(name) and length(name) between 1 and 60 and name !~ '[[:cntrl:]<>]'),
 state jsonb not null,
 version integer not null default 1 check (version between 1 and 2147483646),
 archived boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (user_id,creation_key)
);
create index beta_paper_portfolios_owner on public.beta_paper_portfolios(user_id,archived,updated_at desc);
alter table public.beta_paper_portfolios enable row level security;
revoke all on public.beta_paper_portfolios from public,anon,authenticated,service_role;

-- The execution engine supplies accounting state; this is an additional shape
-- and size boundary, not a second implementation of its accounting rules.
create function beta_private.portfolio_state_valid(candidate jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare key text; n numeric; item jsonb;
begin
 if candidate is null or jsonb_typeof(candidate)<>'object'
    or octet_length(candidate::text)>1048576
    or candidate->'schema' is distinct from '1'::jsonb or candidate->>'currency' is distinct from 'USD'
    or not candidate ?& array['schema','currency','initialCash','cash','settings','positions','orders','fills','events','snapshots','processedCommands','createdAt','updatedAt'] then
  return false;
 end if;
 foreach key in array array['initialCash','cash','createdAt','updatedAt'] loop
  if jsonb_typeof(candidate->key)<>'number' then return false; end if;
  n:=(candidate->>key)::numeric;
  if n<0 or n>9007199254740991 then return false; end if;
 end loop;
 if (candidate->>'initialCash')::numeric<100 or (candidate->>'initialCash')::numeric>10000000
    or (candidate->>'cash')::numeric>1000000000000000
    or (candidate->>'createdAt')::numeric<>trunc((candidate->>'createdAt')::numeric)
    or (candidate->>'updatedAt')::numeric<>trunc((candidate->>'updatedAt')::numeric)
    or (candidate->>'updatedAt')::numeric<(candidate->>'createdAt')::numeric
    or jsonb_typeof(candidate->'settings')<>'object' then return false; end if;
 foreach key in array array['positions','orders','fills','events','snapshots','processedCommands'] loop
  if jsonb_typeof(candidate->key)<>'array' then return false; end if;
 end loop;
 if jsonb_array_length(candidate->'positions')>20
    or jsonb_array_length(candidate->'orders')>5000
    or jsonb_array_length(candidate->'fills')>5000
    or jsonb_array_length(candidate->'events')>10000
    or jsonb_array_length(candidate->'snapshots')>10000
    or jsonb_array_length(candidate->'processedCommands')>100 then return false; end if;
 -- A position must identify an actual positive holding. Prices, fills and P/L
 -- are still computed exclusively by the server engine.
 for item in select value from jsonb_array_elements(candidate->'positions') loop
  if jsonb_typeof(item)<>'object' or coalesce(item->>'symbol','') !~ '^[A-Z][A-Z0-9.-]{0,14}$'
     or jsonb_typeof(item->'quantity') is distinct from 'number'
     or (item->>'quantity')::numeric<=0 or (item->>'quantity')::numeric>1000000000000 then return false; end if;
 end loop;
 return true;
exception when others then
 return false;
end $$;
revoke all on function beta_private.portfolio_state_valid(jsonb) from public,anon,authenticated,service_role;
alter table public.beta_paper_portfolios add constraint beta_paper_portfolios_state_shape check (beta_private.portfolio_state_valid(state));

create function beta_private.portfolio_record(portfolio public.beta_paper_portfolios) returns jsonb
language sql stable strict set search_path='' as $$
 select jsonb_build_object('id',portfolio.id,'name',portfolio.name,'state',portfolio.state,
  'version',portfolio.version,'archived',portfolio.archived,'createdAt',portfolio.created_at,'updatedAt',portfolio.updated_at);
$$;
revoke all on function beta_private.portfolio_record(public.beta_paper_portfolios) from public,anon,authenticated,service_role;

create function public.beta_portfolio_store(
 operation text,uid uuid default null,pid uuid default null,expected_version integer default null,payload jsonb default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 portfolio public.beta_paper_portfolios;
 chosen_name text;
 request_key uuid;
 request_hash text;
 result jsonb;
begin
 if operation is null or operation not in ('list','create','get','save','archive','restore','due') then
  raise exception 'BETA_PORTFOLIO_INVALID';
 end if;
 if operation='due' then
  if uid is not null or pid is not null or expected_version is not null or payload is not null then
   raise exception 'BETA_PORTFOLIO_INVALID';
  end if;
  -- The worker cannot enumerate other users, historical portfolios, or owners
  -- who have since lost the pinned administrator identity or active access.
  select coalesce(jsonb_agg(beta_private.portfolio_record(p) || jsonb_build_object('userId',p.user_id) order by p.updated_at,p.id),'[]'::jsonb) into result
  from (
   select p.* from public.beta_paper_portfolios p
   join auth.users u on u.id=p.user_id
   where not p.archived and lower(u.email)='linoramc@gmail.com' and u.email_confirmed_at is not null
    and public.beta_active_user(p.user_id) and public.beta_is_admin(p.user_id)
   order by p.updated_at,p.id limit 3
  ) p;
  return result;
 end if;
 if uid is null then raise exception 'BETA_PORTFOLIO_FORBIDDEN'; end if;
 -- Serialize a user's capacity checks, idempotent creation and CAS transitions.
 perform pg_advisory_xact_lock(hashtextextended('portfolio:' || uid::text,0));
 if not coalesce(public.beta_active_user(uid),false) or not coalesce(public.beta_is_admin(uid),false)
    or not exists(select 1 from auth.users u where u.id=uid and lower(u.email)='linoramc@gmail.com' and u.email_confirmed_at is not null) then
  raise exception 'BETA_PORTFOLIO_FORBIDDEN';
 end if;
 if operation='list' then
  if pid is not null or expected_version is not null or payload is not null then raise exception 'BETA_PORTFOLIO_INVALID'; end if;
  -- The selector only needs metadata: never transfer fifty accounting states.
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'version',p.version,
   'archived',p.archived,'createdAt',p.created_at,'updatedAt',p.updated_at)
   order by p.archived,p.updated_at desc,p.id),'[]'::jsonb) into result
  from (select p.* from public.beta_paper_portfolios p where p.user_id=uid order by p.archived,p.updated_at desc,p.id limit 50) p;
  return result;
 end if;
 if operation='create' then
  if pid is not null or expected_version is not null or jsonb_typeof(payload) is distinct from 'object'
     or not payload ?& array['name','state','requestId']
     or exists(select 1 from jsonb_object_keys(payload) k where k not in ('name','state','requestId'))
     or jsonb_typeof(payload->'name') is distinct from 'string'
     or jsonb_typeof(payload->'requestId') is distinct from 'string'
     or coalesce(payload->>'requestId','') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
     or not beta_private.portfolio_state_valid(payload->'state') then raise exception 'BETA_PORTFOLIO_INVALID'; end if;
  chosen_name:=btrim(payload->>'name');
  if length(chosen_name) not between 1 and 60 or chosen_name ~ '[[:cntrl:]<>]' then raise exception 'BETA_PORTFOLIO_INVALID'; end if;
  request_key:=(payload->>'requestId')::uuid;
  -- Hash client creation intent, not server-generated timestamps or benchmark
  -- seeds: the same request may be retried after a network timeout. This hash
  -- only detects idempotency-key reuse and is not a credential.
  request_hash:=md5(jsonb_build_object('name',chosen_name,
   'schema',payload->'state'->'schema','currency',payload->'state'->'currency',
   'initialCash',payload->'state'->'initialCash','settings',payload->'state'->'settings')::text);
  select p.* into portfolio from public.beta_paper_portfolios p where p.user_id=uid and p.creation_key=request_key;
  if found then
   if portfolio.creation_hash<>request_hash then raise exception 'BETA_PORTFOLIO_CONFLICT'; end if;
   return beta_private.portfolio_record(portfolio);
  end if;
  if (select count(*) from public.beta_paper_portfolios p where p.user_id=uid)>=50 then raise exception 'BETA_PORTFOLIO_STORAGE_LIMIT'; end if;
  if (select count(*) from public.beta_paper_portfolios p where p.user_id=uid and not p.archived)>=3 then raise exception 'BETA_PORTFOLIO_ACTIVE_LIMIT'; end if;
  insert into public.beta_paper_portfolios(user_id,creation_key,creation_hash,name,state)
   values(uid,request_key,request_hash,chosen_name,payload->'state') returning * into portfolio;
  return beta_private.portfolio_record(portfolio);
 end if;
 if pid is null then raise exception 'BETA_PORTFOLIO_INVALID'; end if;
 select p.* into portfolio from public.beta_paper_portfolios p where p.id=pid and p.user_id=uid for update;
 if not found then raise exception 'BETA_PORTFOLIO_NOT_FOUND'; end if;
 if operation='get' then
  if expected_version is not null or payload is not null then raise exception 'BETA_PORTFOLIO_INVALID'; end if;
  return beta_private.portfolio_record(portfolio);
 end if;
 if expected_version is null or expected_version<1 then raise exception 'BETA_PORTFOLIO_INVALID'; end if;
 if portfolio.version<>expected_version then raise exception 'BETA_PORTFOLIO_CONFLICT'; end if;
 if operation='save' then
  if portfolio.archived then raise exception 'BETA_PORTFOLIO_ARCHIVED'; end if;
  if jsonb_typeof(payload) is distinct from 'object' or not payload ? 'state'
     or exists(select 1 from jsonb_object_keys(payload) k where k not in ('name','state'))
     or not beta_private.portfolio_state_valid(payload->'state')
     or payload->'state'->'initialCash' is distinct from portfolio.state->'initialCash'
     or payload->'state'->'createdAt' is distinct from portfolio.state->'createdAt'
     or (payload->'state'->>'updatedAt')::numeric<(portfolio.state->>'updatedAt')::numeric then raise exception 'BETA_PORTFOLIO_INVALID'; end if;
  chosen_name:=portfolio.name;
  if payload ? 'name' then
   if jsonb_typeof(payload->'name') is distinct from 'string' then raise exception 'BETA_PORTFOLIO_INVALID'; end if;
   chosen_name:=btrim(payload->>'name');
   if length(chosen_name) not between 1 and 60 or chosen_name ~ '[[:cntrl:]<>]' then raise exception 'BETA_PORTFOLIO_INVALID'; end if;
  end if;
  update public.beta_paper_portfolios p set name=chosen_name,state=payload->'state',version=p.version+1,updated_at=clock_timestamp()
   where p.id=pid and p.user_id=uid and p.version=expected_version and not p.archived returning p.* into portfolio;
 else
  if payload is not null and (jsonb_typeof(payload) is distinct from 'object'
     or exists(select 1 from jsonb_object_keys(payload) k where k<>'requestId')
     or (payload ? 'requestId' and (jsonb_typeof(payload->'requestId') is distinct from 'string'
      or coalesce(payload->>'requestId','') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'))) then raise exception 'BETA_PORTFOLIO_INVALID'; end if;
  if portfolio.archived=(operation='archive') then return beta_private.portfolio_record(portfolio); end if;
  if operation='restore' and (select count(*) from public.beta_paper_portfolios p where p.user_id=uid and not p.archived)>=3 then raise exception 'BETA_PORTFOLIO_ACTIVE_LIMIT'; end if;
  update public.beta_paper_portfolios p set archived=(operation='archive'),version=p.version+1,updated_at=clock_timestamp()
   where p.id=pid and p.user_id=uid and p.version=expected_version returning p.* into portfolio;
 end if;
 if not found then raise exception 'BETA_PORTFOLIO_CONFLICT'; end if;
 return beta_private.portfolio_record(portfolio);
end $$;
revoke all on function public.beta_portfolio_store(text,uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.beta_portfolio_store(text,uuid,uuid,integer,jsonb) to service_role;

comment on table public.beta_paper_portfolios is 'Administrator-only simulated portfolios. No real trading or broker credentials.';
comment on function public.beta_portfolio_store(text,uuid,uuid,integer,jsonb) is 'Service-only, pinned-active-admin paper portfolio persistence; bounded state, owner binding and CAS.';

commit;
