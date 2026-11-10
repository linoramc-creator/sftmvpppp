begin;

-- Preserve the original RPC implementation for all existing operations. The
-- public wrapper adds metadata-only naming without altering accounting state.
alter function public.beta_portfolio_store(text,uuid,uuid,integer,jsonb) set schema beta_private;
alter function beta_private.beta_portfolio_store(text,uuid,uuid,integer,jsonb) rename to portfolio_store_v1;
revoke all on function beta_private.portfolio_store_v1(text,uuid,uuid,integer,jsonb) from public,anon,authenticated,service_role;

create table public.beta_portfolio_rename_requests (
 user_id uuid not null references public.beta_profiles(id) on delete cascade,
 request_id uuid not null,
 portfolio_id uuid not null references public.beta_paper_portfolios(id) on delete cascade,
 name text not null check (name=btrim(name) and length(name) between 1 and 60 and name !~ '[[:cntrl:]<>]'),
 created_at timestamptz not null default now(),
 primary key(user_id,request_id)
);
alter table public.beta_portfolio_rename_requests enable row level security;
revoke all on public.beta_portfolio_rename_requests from public,anon,authenticated,service_role;

create function public.beta_portfolio_store(
 operation text,uid uuid default null,pid uuid default null,expected_version integer default null,payload jsonb default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare portfolio public.beta_paper_portfolios; prior public.beta_portfolio_rename_requests; request_key uuid; chosen_name text;
begin
 if operation is distinct from 'rename' then
  return beta_private.portfolio_store_v1(operation,uid,pid,expected_version,payload);
 end if;
 if uid is null then raise exception 'BETA_PORTFOLIO_FORBIDDEN'; end if;
 perform pg_advisory_xact_lock(hashtextextended('portfolio:' || uid::text,0));
 if not coalesce(public.beta_active_user(uid),false) or not coalesce(public.beta_is_admin(uid),false)
    or not exists(select 1 from auth.users u where u.id=uid and lower(u.email)='linoramc@gmail.com' and u.email_confirmed_at is not null) then
  raise exception 'BETA_PORTFOLIO_FORBIDDEN';
 end if;
 if pid is null or expected_version is null or expected_version<1 or jsonb_typeof(payload) is distinct from 'object'
    or not payload ?& array['requestId','name']
    or exists(select 1 from jsonb_object_keys(payload) k where k not in ('requestId','name'))
    or jsonb_typeof(payload->'name') is distinct from 'string'
    or jsonb_typeof(payload->'requestId') is distinct from 'string'
    or coalesce(payload->>'requestId','') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then raise exception 'BETA_PORTFOLIO_INVALID'; end if;
 chosen_name:=btrim(payload->>'name'); request_key:=(payload->>'requestId')::uuid;
 if length(chosen_name) not between 1 and 60 or chosen_name ~ '[[:cntrl:]<>]' then raise exception 'BETA_PORTFOLIO_INVALID'; end if;
 select p.* into portfolio from public.beta_paper_portfolios p where p.id=pid and p.user_id=uid for update;
 if not found then raise exception 'BETA_PORTFOLIO_NOT_FOUND'; end if;
 select r.* into prior from public.beta_portfolio_rename_requests r where r.user_id=uid and r.request_id=request_key;
 if found then
  if prior.portfolio_id<>pid or prior.name<>chosen_name then raise exception 'BETA_PORTFOLIO_CONFLICT'; end if;
  return beta_private.portfolio_record(portfolio);
 end if;
 if portfolio.version<>expected_version then raise exception 'BETA_PORTFOLIO_CONFLICT'; end if;
 if (select count(*) from public.beta_portfolio_rename_requests r where r.user_id=uid)>=10000 then raise exception 'BETA_PORTFOLIO_STORAGE_LIMIT'; end if;
 insert into public.beta_portfolio_rename_requests(user_id,request_id,portfolio_id,name) values(uid,request_key,pid,chosen_name);
 update public.beta_paper_portfolios p set name=chosen_name,version=p.version+1,updated_at=clock_timestamp()
  where p.id=pid and p.user_id=uid and p.version=expected_version returning p.* into portfolio;
 if not found then raise exception 'BETA_PORTFOLIO_CONFLICT'; end if;
 return beta_private.portfolio_record(portfolio);
end $$;
revoke all on function public.beta_portfolio_store(text,uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.beta_portfolio_store(text,uuid,uuid,integer,jsonb) to service_role;

-- Short liabilities and a negative cash debt after a forced close are signed
-- accounting values. They are not permission to open uncollateralized orders:
-- the server engine enforces collateral and margin-call restrictions.
create or replace function beta_private.portfolio_state_valid(candidate jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare key text; n numeric; item jsonb; q numeric; basis numeric;
begin
 if candidate is null or jsonb_typeof(candidate)<>'object' or octet_length(candidate::text)>1048576
    or candidate->'schema' is distinct from '1'::jsonb or candidate->>'currency' is distinct from 'USD'
    or not candidate ?& array['schema','currency','initialCash','cash','settings','positions','orders','fills','events','snapshots','processedCommands','createdAt','updatedAt'] then return false; end if;
 foreach key in array array['initialCash','cash','createdAt','updatedAt'] loop
  if jsonb_typeof(candidate->key)<>'number' then return false; end if;
  n:=(candidate->>key)::numeric;
  if abs(n)>9007199254740991 or (key<>'cash' and n<0) then return false; end if;
 end loop;
 if (candidate->>'initialCash')::numeric<100 or (candidate->>'initialCash')::numeric>10000000
    or abs((candidate->>'cash')::numeric)>1000000000000000
    or (candidate->>'createdAt')::numeric<>trunc((candidate->>'createdAt')::numeric)
    or (candidate->>'updatedAt')::numeric<>trunc((candidate->>'updatedAt')::numeric)
    or (candidate->>'updatedAt')::numeric<(candidate->>'createdAt')::numeric
    or jsonb_typeof(candidate->'settings')<>'object' then return false; end if;
 foreach key in array array['positions','orders','fills','events','snapshots','processedCommands'] loop
  if jsonb_typeof(candidate->key)<>'array' then return false; end if;
 end loop;
 if jsonb_array_length(candidate->'positions')>20 or jsonb_array_length(candidate->'orders')>5000
    or jsonb_array_length(candidate->'fills')>5000 or jsonb_array_length(candidate->'events')>10000
    or jsonb_array_length(candidate->'snapshots')>10000 or jsonb_array_length(candidate->'processedCommands')>100 then return false; end if;
 for item in select value from jsonb_array_elements(candidate->'positions') loop
  if jsonb_typeof(item)<>'object' or coalesce(item->>'symbol','') !~ '^[A-Z][A-Z0-9.-]{0,14}$'
     or jsonb_typeof(item->'quantity') is distinct from 'number' then return false; end if;
  q:=(item->>'quantity')::numeric;
  if q=0 or abs(q)>1000000000000 then return false; end if;
  if item ? 'costBasis' then
   if jsonb_typeof(item->'costBasis') is distinct from 'number' then return false; end if;
   basis:=(item->>'costBasis')::numeric;
   if abs(basis)>1000000000000000 or basis*q<0 then return false; end if;
  end if;
  if item ? 'averageCost' and (jsonb_typeof(item->'averageCost') is distinct from 'number' or (item->>'averageCost')::numeric<0) then return false; end if;
  if item ? 'shortProceeds' and (jsonb_typeof(item->'shortProceeds') is distinct from 'number' or (item->>'shortProceeds')::numeric<0 or (item->>'shortProceeds')::numeric>1000000000000000) then return false; end if;
 end loop;
 return true;
exception when others then return false;
end $$;
revoke all on function beta_private.portfolio_state_valid(jsonb) from public,anon,authenticated,service_role;

commit;

