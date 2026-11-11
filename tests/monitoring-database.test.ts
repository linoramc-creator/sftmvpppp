import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {evaluateMonitoringAlert} from '../supabase/functions/analyze-ticker/monitoring-engine.ts';
const pg=await import(pathToFileURL(process.env.RESEARCH_PGLITE_MODULE??resolve('../../tools/research-pg/node_modules/@electric-sql/pglite/dist/index.js')).href).catch(()=>null);
const admin='11111111-1111-4111-8111-111111111111',reader='22222222-2222-4222-8222-222222222222',third='33333333-3333-4333-8333-333333333333';
const conditions=[{field:'price',op:'gt',value:100,currency:'USD'}];
const iso=(offset=0)=>new Date(Date.now()+offset).toISOString();
const snapshot=(symbol:string,price=105,asOf=iso(-2000)):any=>({schema:1,symbol,name:'Verified asset',kind:'stock',currency:'USD',collectedAt:iso(),metrics:{price:{value:price,asOf,source:'Verified exchange observation',url:'https://example.test/asset',unit:'currency',currency:'USD',maxAgeHours:1}},news:[],calendar:[],holdings:null,coverage:[],fundamentalsAt:null});
const news=(symbol:string,key='news:shared'):any=>({key,symbol,kind:'news',title:'Verified business announcement',detail:'Source-backed business event.',occurredAt:iso(-60000),source:'Issuer release',url:'https://example.test/news',importance:'high'});
const evaluate=(snap:any,matched:boolean|null=true,status?:string):any=>({status:status??(matched===null?'missing':matched?'matched':'unmatched'),matched,reason:'Verified threshold evaluation.',checkedAt:iso(),conditions:conditions.map(condition=>({condition,status:matched===null?'missing':matched?'met':'unmet',value:matched===null?null:snap.metrics.price.value,asOf:matched===null?null:snap.metrics.price.asOf,source:matched===null?'':snap.metrics.price.source,url:matched===null?'':snap.metrics.price.url}))});

test('isolated PostgreSQL monitoring owns receipts and rules, leases work, and preserves every existing portfolio',{skip:pg?false:'PGlite not installed'},async t=>{
 const db=new pg.PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,last_sign_in_at timestamptz);create function auth.uid() returns uuid language sql as $$select null::uuid$$;`);
 const migrate=async(name:string)=>db.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
 await migrate('202609160001_secure_beta.sql');await migrate('202609160002_private_policy_helper.sql');
 await db.query('insert into auth.users values($1,$2,now(),now()),($3,$4,now(),now()),($5,$6,now(),now())',[admin,'linoramc@gmail.com',reader,'reader@example.test',third,'third@example.test']);await migrate('202609160003_pin_admin_identity.sql');
 await migrate('202611100001_portfolio_lab.sql');await migrate('202611100003_portfolio_risk.sql');
 await db.exec(`create table public.beta_watchlists(user_id uuid primary key references public.beta_profiles(id),symbols text[] not null default '{}');create schema cron;create table cron.jobs(name text,schedule text,command text);create function cron.schedule(name text,schedule text,command text) returns bigint language plpgsql as $$begin insert into cron.jobs values(name,schedule,command);return 1;end$$;create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text);insert into vault.decrypted_secrets values('terminal_brief_cron','test-only-server-secret-never-published');create schema net;create table net.calls(url text,headers jsonb,body jsonb);create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language plpgsql as $$begin insert into net.calls values(url,headers,body);return 1;end$$;`);
 await db.query("insert into public.beta_watchlists values($1,array['AAPL']),($2,array['AAPL','SPY']),($3,array['MSFT'])",[admin,reader,third]);
 const state={schema:1,currency:'USD',initialCash:10000,cash:10000,settings:{},positions:[{symbol:'VRT',quantity:-1,costBasis:-100,averageCost:100,shortProceeds:100}],orders:[],fills:[],events:[],snapshots:[],processedCommands:[],createdAt:Date.now()-60000,updatedAt:Date.now()-60000};
 const pid=randomUUID();await db.query("insert into public.beta_paper_portfolios(id,user_id,creation_key,creation_hash,name,state) values($1,$2,$3,repeat('a',32),'Original admin portfolio',$4::jsonb),($5,$6,$7,repeat('b',32),'Never visible outside owner',$8::jsonb)",[pid,admin,randomUUID(),JSON.stringify(state),randomUUID(),reader,randomUUID(),JSON.stringify({...state,positions:[{symbol:'SECRET',quantity:1,costBasis:100,averageCost:100}]})]);
 const original=(await db.query('select * from public.beta_paper_portfolios order by id')).rows;
 await migrate('202611110001_monitoring.sql');
 const rpc=async(operation:string,uid:string|null=reader,payload:any={})=>(await db.query('select public.beta_monitor_store($1,$2::uuid,$3::jsonb) result',[operation,uid,JSON.stringify(payload)])).rows[0].result as any;
 const rule=(symbol='AAPL',name='My price rule',extra:any={})=>({requestId:randomUUID(),symbol,name,conditions,enabled:true,...extra});
 const claim=async(symbol:string)=>{await db.query("update public.beta_monitor_assets set due_at=now()-interval '1 minute',lease_until=null,lease_token=null where symbol=$1",[symbol]);const items=await rpc('claim_assets',null,{limit:8});const found=items.find((x:any)=>x.symbol===symbol);assert.ok(found);return found;};
 const commit=async(job:any,snap:any,changes:any[]=[],evaluations:any[]=[])=>rpc('commit_asset',null,{symbol:job.symbol,token:job.token,snapshot:snap,changes,evaluations});
 let alert:any;

 await t.test('table, helper and worker privileges prevent browser access and forged workers',async()=>{
  for(const role of ['anon','authenticated','service_role']){await db.exec('set role '+role);for(const table of ['assets','history','events','alerts','alert_requests','notices','visitors','visits','analysis_budget'])await assert.rejects(db.query('select * from public.beta_monitor_'+table),/permission denied/);await assert.rejects(db.query('select * from beta_private.monitor_subscriptions()'),/permission denied/);if(role!=='service_role')await assert.rejects(rpc('context'),/permission denied/);else assert.deepEqual((await rpc('context')).portfolios,[]);await db.exec('reset role');}
  await assert.rejects(rpc('claim_assets',reader),/BETA_MONITOR_FORBIDDEN/);await assert.rejects(rpc('context',null),/BETA_MONITOR_REVOKED/);
  const guards=(await db.query("select bool_and(relrowsecurity) enabled from pg_class where relname like 'beta_monitor_%' and relkind='r'")).rows[0];assert.equal(guards.enabled,true);
 });
 await t.test('context returns only the active owner watchlist and actual pinned-admin positions',async()=>{
  const ordinary=await rpc('context');assert.deepEqual(ordinary.watchlist,['AAPL','SPY']);assert.deepEqual(ordinary.symbols,['AAPL','SPY']);assert.deepEqual(ordinary.portfolios,[]);
  const owner=await rpc('context',admin);assert.ok(owner.symbols.includes('VRT'));assert.equal(owner.portfolios.length,1);assert.equal(owner.portfolios[0].id,pid);assert.deepEqual(owner.portfolios[0].state,state);
  await db.query('update auth.users set email=$2 where id=$1',[admin,'changed@example.test']);assert.deepEqual((await rpc('context',admin)).portfolios,[]);assert.ok(!(await rpc('context',admin)).symbols.includes('VRT'));await db.query('update auth.users set email=$2 where id=$1',[admin,'linoramc@gmail.com']);
 });
 await t.test('visit retries and simultaneous tabs share a stable previous visit instead of moving the baseline',async()=>{
  const visitId=randomUUID(),first=await rpc('visit',reader,{visitId});assert.equal(first.baseline,null);assert.deepEqual(await rpc('visit',reader,{visitId}),first);assert.deepEqual(await rpc('visit',reader,{visitId:randomUUID()}),first);
  await db.query("update public.beta_monitor_visitors set last_seen_at=now()-interval '31 minutes' where user_id=$1",[reader]);
  const second=await rpc('visit',reader,{visitId:randomUUID()});assert.equal(second.baseline,first.visitAt);assert.deepEqual(await rpc('visit',reader,{visitId}),first);assert.deepEqual(await rpc('visit',reader,{visitId:randomUUID()}),second);assert.equal((await rpc('visit',third,{visitId:randomUUID()})).baseline,null);
  await assert.rejects(rpc('visit',reader,{visitId:'bad'}),/BETA_MONITOR_INVALID/);
 });
 await t.test('owner-bound alert CRUD validates configuration, request idempotency and revision conflicts',async()=>{
  const input=rule();alert=await rpc('save_alert',reader,input);assert.equal(alert.revision,1);assert.equal((await rpc('save_alert',reader,input)).id,alert.id);await assert.rejects(rpc('save_alert',reader,{...input,name:'Changed payload'}),/BETA_MONITOR_CONFLICT/);
  const megacap=await rpc('save_alert',reader,rule('AAPL','Megacap threshold',{conditions:[{field:'marketCap',op:'gt',value:2e12,currency:'USD'}]}));assert.equal(megacap.conditions[0].value,2e12);await rpc('delete_alert',reader,{id:megacap.id,revision:megacap.revision});
  await assert.rejects(rpc('save_alert',reader,rule('AAPL','Excess market cap',{conditions:[{field:'marketCap',op:'gt',value:1e16+2,currency:'USD'}]})),/BETA_MONITOR_INVALID/);await assert.rejects(rpc('save_alert',reader,rule('AAPL','Excess price',{conditions:[{field:'price',op:'gt',value:2e12,currency:'USD'}]})),/BETA_MONITOR_INVALID/);
  for(const payload of [{...rule(),userId:admin},{...rule(),conditions:[{field:'price',op:'gt',value:100}]},{...rule(),conditions:[{field:'pe',op:'bad',value:10}]},{...rule(),conditions:Array(6).fill(conditions[0])},{...rule(),conditions:[{field:'pe',op:'gt',value:1e20}]},{...rule(),name:'<script>'}])await assert.rejects(rpc('save_alert',reader,payload),/BETA_MONITOR_INVALID/);
  await assert.rejects(rpc('pause_alert',third,{id:alert.id,revision:alert.revision,enabled:false}),/BETA_MONITOR_NOT_FOUND/);await assert.rejects(rpc('delete_alert',third,{id:alert.id,revision:alert.revision}),/BETA_MONITOR_NOT_FOUND/);
  const paused=await rpc('pause_alert',reader,{id:alert.id,revision:alert.revision,enabled:false});assert.equal(paused.enabled,false);assert.equal(paused.evaluation.status,'paused');await assert.rejects(rpc('pause_alert',reader,{id:alert.id,revision:alert.revision,enabled:true}),/BETA_MONITOR_CONFLICT/);alert=await rpc('pause_alert',reader,{id:alert.id,revision:paused.revision,enabled:true});
  const disposableInput=rule('AAPL','Delete safely'),disposable=await rpc('save_alert',reader,disposableInput);await rpc('delete_alert',reader,{id:disposable.id,revision:disposable.revision});await assert.rejects(rpc('save_alert',reader,disposableInput),/BETA_MONITOR_NOT_FOUND/);await assert.rejects(rpc('save_alert',reader,{...disposableInput,name:'Different retry'}),/BETA_MONITOR_CONFLICT/);assert.ok(!(await rpc('list')).alerts.some((a:any)=>a.id===disposable.id));
 });
 await t.test('shared claims lease each asset once and bootstrap emits only recent sourced news to relevant active users',async()=>{
  const jobs=await rpc('claim_assets',null,{limit:8});assert.deepEqual(jobs.map((j:any)=>j.symbol).sort(),['AAPL','MSFT','SPY','VRT']);assert.deepEqual(await rpc('claim_assets',null,{limit:8}),[]);const job=jobs.find((j:any)=>j.symbol==='AAPL'),snap=snapshot('AAPL');
  const payload={symbol:job.symbol,token:job.token,snapshot:snap,changes:[news('AAPL'),{...news('AAPL','first-price'),kind:'price'}, {...news('AAPL','old-news'),occurredAt:iso(-2*86400000)}],evaluations:[]};
  assert.equal((await rpc('commit_asset',null,payload)).cached,false);assert.equal((await rpc('commit_asset',null,payload)).cached,true);await assert.rejects(rpc('commit_asset',null,{...payload,snapshot:{...snap,name:'Different replay'}}),/BETA_MONITOR_CONFLICT/);
  assert.equal((await rpc('list',reader)).notices.length,1);assert.equal((await rpc('list',admin)).notices.length,1);assert.equal((await rpc('list',third)).notices.length,0);assert.equal((await rpc('list',reader)).notices[0].key,'news:shared');
  const foreign=(await rpc('list',admin)).notices[0].id;await rpc('read',reader,{ids:[foreign]});assert.equal((await rpc('list',admin)).unread,1);const own=(await rpc('list',reader)).notices[0];await rpc('read',reader,{ids:[own.id]});await rpc('read',reader,{ids:[own.id]});assert.equal((await rpc('list',reader)).unread,0);assert.equal((await rpc('list',reader,{unreadOnly:true})).notices.length,0);
 });
 await t.test('alerts notify once on fresh false-to-true, preserve state through unknown and pause/resume, and rearm on fresh false',async()=>{
  const cycle=async(price:number,matched:boolean|null,offset:number)=>{const job=await claim('AAPL'),snap=snapshot('AAPL',price,iso(offset));return commit(job,snap,[],[{id:alert.id,revision:alert.revision,evaluation:evaluate(snap,matched)}]);};
  const first=await cycle(105,true,-1200);assert.equal(first.ignoredEvaluations,0);let list=await rpc('list',reader);assert.equal(list.alerts[0].lastMatched,true);assert.equal(list.notices.filter((n:any)=>n.kind==='alert').length,1);
  await cycle(106,true,-1000);await cycle(106,null,-900);assert.equal((await rpc('list',reader)).alerts[0].lastMatched,true);assert.equal((await rpc('list',reader)).notices.filter((n:any)=>n.kind==='alert').length,1);
  alert=await rpc('pause_alert',reader,{id:alert.id,revision:alert.revision,enabled:false});alert=await rpc('pause_alert',reader,{id:alert.id,revision:alert.revision,enabled:true});await cycle(107,true,-800);assert.equal((await rpc('list',reader)).notices.filter((n:any)=>n.kind==='alert').length,1);
  await cycle(90,false,-600);assert.equal((await rpc('list',reader)).alerts[0].lastMatched,false);await cycle(108,true,-400);list=await rpc('list',reader);assert.equal(list.notices.filter((n:any)=>n.kind==='alert').length,2);
  const staleJob=await claim('AAPL'),snap=snapshot('AAPL',90,iso(-300)),forged=evaluate(snap,true);assert.equal((await commit(staleJob,snap,[],[{id:alert.id,revision:alert.revision,evaluation:forged}])).ignoredEvaluations,1);assert.equal((await rpc('list',reader)).alerts[0].lastMatched,true);
  const edited=await rpc('save_alert',reader,{id:alert.id,revision:alert.revision,symbol:'AAPL',name:'New threshold',conditions:[{...conditions[0],value:200}],enabled:true});const job=await claim('AAPL');assert.equal((await commit(job,snapshot('AAPL'),[],[{id:alert.id,revision:alert.revision,evaluation:evaluate(snapshot('AAPL'))}])).ignoredEvaluations,1);alert=edited;
 });
 await t.test('real engine EPS revisions with unchanged published dates still rearm on each fresh collected observation',async()=>{
  const rule=await rpc('save_alert',reader,{requestId:randomUUID(),symbol:'AAPL',name:'Published EPS threshold',conditions:[{field:'epsEstimate',op:'gt',value:2,currency:'USD',period:'FY2026'}],enabled:true}),published=iso(-3600000);
  for(const value of [3,1,3]){const job=await claim('AAPL'),snap=snapshot('AAPL');snap.metrics.epsEstimate={value,asOf:published,source:'Published estimates',url:'https://example.com/estimates',unit:'currency',currency:'USD',period:'FY2026',maxAgeHours:240};const evaluation=evaluateMonitoringAlert(rule,snap,Date.now());assert.equal((await commit(job,snap,[],[{id:rule.id,revision:rule.revision,evaluation}])).ignoredEvaluations,0);}
  const notices=(await rpc('list')).notices.filter((n:any)=>n.alertId===rule.id);assert.equal(notices.length,2);assert.match(notices[0].detail,/epsEstimate gt 2 USD/);assert.equal(notices[0].conditions[0].value,3);assert.equal(notices[0].conditions[0].asOf,published);
 });
 await t.test('timestamp pagination does not lose tied batches and bounded history preserves a daily trail',async()=>{
  for(let batch=0;batch<2;batch++){const job=await claim('AAPL');await commit(job,snapshot('AAPL'),Array.from({length:40},(_,i)=>news('AAPL',`page:${batch}:${i}`)));}
  const first=await rpc('list');assert.equal(first.notices.length,50);assert.equal(first.hasMore,true);const second=await rpc('list',reader,{before:first.notices.at(-1).createdAt});assert.ok(second.notices.length>=30);assert.ok(!second.notices.some((n:any)=>first.notices.some((p:any)=>p.id===n.id)));
  await db.query("insert into public.beta_monitor_history(symbol,observed_at,metrics) select 'AAPL',now()-n*interval '1 hour','{}'::jsonb from generate_series(1,960) n");
  const job=await claim('AAPL');await commit(job,snapshot('AAPL'));const history=(await db.query("select count(*)::integer n,min(observed_at)<now()-interval '28 days' daily_trail,min(observed_at)>now()-interval '31 days' lifetime from public.beta_monitor_history where symbol='AAPL'")).rows[0];assert.ok(history.n<=64);assert.equal(history.daily_trail,true);assert.equal(history.lifetime,true);
 });
 await t.test('ETF look-through queues only ten verified underlying symbols without sharing a different owner portfolio',async()=>{
  const job=await claim('SPY'),snap=snapshot('SPY');snap.kind='etf';snap.holdings={asOf:iso(-86400000),source:'Published portfolio',url:'https://example.test/fund',coveragePct:50,items:Array.from({length:12},(_,i)=>({symbol:'H'+String.fromCharCode(65+i),name:'Holding',weightPct:5}))};await commit(job,snap);
  const context=await rpc('context',reader);assert.equal(context.symbols.filter((s:string)=>s.startsWith('H')).length,10);assert.deepEqual(context.portfolios,[]);const jobs=await rpc('claim_assets',null,{limit:8});assert.ok(jobs.length<=8);assert.ok(jobs.some((j:any)=>j.symbol.startsWith('H')));
 });
 await t.test('expired tokens and failures back off; revoked owners cannot read rules or receive new notices',async()=>{
  const job=await claim('AAPL');await db.query("update public.beta_monitor_assets set lease_until=now()-interval '1 second' where symbol='AAPL'");await assert.rejects(commit(job,snapshot('AAPL')),/BETA_MONITOR_CONFLICT/);
  const retry=await claim('AAPL');await rpc('fail_asset',null,{symbol:'AAPL',token:retry.token});assert.ok((await db.query("select due_at>now()+interval '4 minutes' delayed from public.beta_monitor_assets where symbol='AAPL'")).rows[0].delayed);
  await db.query('update public.beta_profiles set revoked=true where id=$1',[reader]);for(const operation of ['context','list','visit','read','save_alert'])await assert.rejects(rpc(operation,reader,{}),/BETA_MONITOR_REVOKED/);
  const countBefore=(await db.query('select count(*)::integer n from public.beta_monitor_notices where user_id=$1',[reader])).rows[0].n;const recovered=await claim('AAPL');await commit(recovered,snapshot('AAPL'),[news('AAPL','after-revoke')]);assert.equal((await db.query('select count(*)::integer n from public.beta_monitor_notices where user_id=$1',[reader])).rows[0].n,countBefore);await db.query('update public.beta_profiles set revoked=false where id=$1',[reader]);
 });
 await t.test('global interpretation budget is atomic, finite and nonrefundable; five-minute cron runs with no browser session',async()=>{
  for(let i=0;i<96;i++)assert.equal((await rpc('analysis_budget',null)).allowed,true);assert.deepEqual(await rpc('analysis_budget',null),{allowed:false,remaining:0});await assert.rejects(rpc('analysis_budget',reader),/BETA_MONITOR_FORBIDDEN/);
  const schedule=(await db.query("select * from cron.jobs where name='terminal-monitoring'")).rows[0];assert.equal(schedule.schedule,'*/5 * * * *');await db.exec('select public.beta_run_monitor_schedule()');const request=(await db.query('select url,headers,body from net.calls')).rows[0];assert.ok(request.url.endsWith('/monitoring-worker'));assert.equal(request.headers['x-monitor-job'],'test-only-server-secret-never-published');assert.deepEqual(request.body,{operation:'run'});
  assert.deepEqual((await db.query('select * from public.beta_paper_portfolios order by id')).rows,original);
 });
});
