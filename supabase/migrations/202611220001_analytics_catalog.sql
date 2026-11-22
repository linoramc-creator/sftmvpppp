begin;
-- Expand the closed financial catalog; forecast multiples are current snapshots only.
-- Existing definitions, users, snapshots and trading ledgers remain untouched.
create or replace function public.beta_analytics_store(operation text,uid uuid,payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item public.beta_analytics_queries; result jsonb; item_id uuid; request uuid; signature text;
begin
 if current_user<>'postgres' and auth.role() is distinct from 'service_role' then raise exception 'BETA_ANALYTICS_FORBIDDEN';end if;
 if uid is null or not public.beta_active_user(uid) then raise exception 'BETA_ANALYTICS_FORBIDDEN';end if;
 if operation not in ('list','save','delete') or jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>16000 then raise exception 'BETA_ANALYTICS_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('analytics:'||uid::text,0));
 if operation='list' then
  select coalesce(jsonb_agg(to_jsonb(q) order by q.updated_at desc,q.id),'[]'::jsonb) into result from (select id,name,query,revision,created_at,updated_at from public.beta_analytics_queries where user_id=uid and deleted_at is null order by updated_at desc,id limit 100) q;
  return result;
 end if;
 if payload ? 'id' then
  item_id:=(payload->>'id')::uuid;
  select * into item from public.beta_analytics_queries where id=item_id and user_id=uid and deleted_at is null for update;
  if not found then raise exception 'BETA_ANALYTICS_NOT_FOUND';end if;
  if item.revision is distinct from (payload->>'revision')::integer then raise exception 'BETA_ANALYTICS_CONFLICT';end if;
  if operation='delete' then update public.beta_analytics_queries set deleted_at=now(),revision=revision+1,updated_at=now() where id=item.id;return jsonb_build_object('ok',true);end if;
 elsif operation='delete' then raise exception 'BETA_ANALYTICS_INVALID';end if;
 if jsonb_typeof(payload->'name') is distinct from 'string' or length(btrim(payload->>'name')) not between 1 and 100 or payload->>'name' ~ '[[:cntrl:]<>]'
  or jsonb_typeof(payload->'query') is distinct from 'object' or payload->'query'->>'version' is distinct from '1' or octet_length((payload->'query')::text)>12000
  or jsonb_typeof(payload->'query'->'assets') is distinct from 'array' or jsonb_array_length(payload->'query'->'assets')>8
  or payload->'query'->>'dataKind' is distinct from (case when payload->'query'->>'metric'='forwardPeCurrent' then 'estimate' else 'reported' end)
  or coalesce(payload->'query'->>'operation','') not in ('level','base100','growth_yoy','growth_qoq','ratio')
  or coalesce(payload->'query'->>'metric','') not in ('price','realizedVolatility','drawdown','rollingCorrelation','rollingBeta','relativeStrength','revenue','netIncome','grossProfit','operatingIncome','researchDevelopment','currentAssets','currentLiabilities','netDebt','forwardPeCurrent','trailingPeCurrent','priceToBookCurrent','enterpriseToEbitdaCurrent','operatingCashFlow','freeCashFlow','capex','capexAI','cash','totalDebt','equity','totalAssets','portfolioExposure')
  or exists(select 1 from jsonb_object_keys(payload->'query') k where k not in ('version','assets','metric','operation','denominator','period','frequency','currency','chart','dataKind','portfolioId','window','benchmark'))
 then raise exception 'BETA_ANALYTICS_INVALID';end if;
 if payload->'query'->>'metric' in ('realizedVolatility','drawdown','rollingCorrelation','rollingBeta','relativeStrength') then
  if payload->'query'->>'operation'<>'level' or payload->'query'->>'frequency' not in ('daily','weekly','monthly') or payload->'query' ? 'denominator' then raise exception 'BETA_ANALYTICS_INVALID';end if;
 end if;
 if payload->'query'->>'metric' in ('forwardPeCurrent','trailingPeCurrent','priceToBookCurrent','enterpriseToEbitdaCurrent') then
  if payload->'query'->>'operation' is distinct from 'level' or payload->'query'->>'frequency' is distinct from 'daily' or payload->'query'->>'chart' is distinct from 'bar' or payload->'query' ? 'denominator' or payload->'query' ? 'window' or payload->'query' ? 'benchmark' then raise exception 'BETA_ANALYTICS_INVALID';end if;
 end if;
 if payload->'query'->>'operation'='ratio' and coalesce((payload->'query'->>'metric')||'/'||(payload->'query'->>'denominator'),'') not in ('netIncome/revenue','grossProfit/revenue','operatingIncome/revenue','researchDevelopment/revenue','freeCashFlow/revenue','operatingCashFlow/revenue','capex/revenue','totalDebt/equity','totalDebt/totalAssets','cash/totalDebt','currentAssets/currentLiabilities','cash/currentLiabilities','capex/operatingCashFlow') then raise exception 'BETA_ANALYTICS_INVALID';end if;
 if payload->'query' ? 'window' then
  if payload->'query'->>'metric' not in ('realizedVolatility','rollingCorrelation','rollingBeta') or jsonb_typeof(payload->'query'->'window') is distinct from 'number' or (payload->'query'->>'window')::numeric not in (20,60,120) then raise exception 'BETA_ANALYTICS_INVALID';end if;
 end if;
 if payload->'query'->>'metric' in ('rollingCorrelation','rollingBeta','relativeStrength') then
  if jsonb_typeof(payload->'query'->'benchmark') is distinct from 'string' or not (payload->'query'->'assets' @> jsonb_build_array(payload->'query'->>'benchmark')) or jsonb_array_length(payload->'query'->'assets')<2 or payload->'query'->>'currency' not in ('USD','EUR','GBP') then raise exception 'BETA_ANALYTICS_INVALID';end if;
 elsif payload->'query' ? 'benchmark' then raise exception 'BETA_ANALYTICS_INVALID';end if;
 if item_id is null then
  request:=(payload->>'requestId')::uuid;if request is null then raise exception 'BETA_ANALYTICS_INVALID';end if;
  signature:=md5(btrim(payload->>'name')||(payload->'query')::text);
  select * into item from public.beta_analytics_queries where user_id=uid and request_id=request;
  if found then
   if item.deleted_at is not null then raise exception 'BETA_ANALYTICS_NOT_FOUND';end if;
   if item.create_hash<>signature then raise exception 'BETA_ANALYTICS_CONFLICT';end if;
  else
   if (select count(*) from public.beta_analytics_queries where user_id=uid and deleted_at is null)>=100 then raise exception 'BETA_ANALYTICS_LIMIT';end if;
   insert into public.beta_analytics_queries(user_id,request_id,create_hash,name,query) values(uid,request,signature,btrim(payload->>'name'),payload->'query') returning * into item;
  end if;
 else
  update public.beta_analytics_queries set name=btrim(payload->>'name'),query=payload->'query',revision=revision+1,updated_at=now() where id=item.id returning * into item;
 end if;
 return jsonb_build_object('id',item.id,'name',item.name,'query',item.query,'revision',item.revision,'created_at',item.created_at,'updated_at',item.updated_at);
end $$;

commit;
