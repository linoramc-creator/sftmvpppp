import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createPortfolioState} from '../supabase/functions/analyze-ticker/portfolio-model.ts';

const pg=await import(pathToFileURL(process.env.RESEARCH_PGLITE_MODULE??resolve('../../tools/research-pg/node_modules/@electric-sql/pglite/dist/index.js')).href).catch(()=>null);
const admin='11111111-1111-4111-8111-111111111111',reader='22222222-2222-4222-8222-222222222222',third='33333333-3333-4333-8333-333333333333';
const definition={version:1,assets:['MSFT','^GSPC'],metric:'price',operation:'base100',period:{range:'2y'},frequency:'daily',currency:'original',chart:'line',dataKind:'reported'};

// Real PostgreSQL semantics in an isolated in-memory database. No production
// credentials, network data, orders, portfolios or user accounts are touched.
test('Analytics PostgreSQL enforces owned definitions, service-only access, bounded receipts and read-only portfolios',{skip:pg?false:'PGlite not installed'},async t=>{
 const db=new pg.PGlite();t.after(()=>db.close());
 await db.exec(`
  create role anon;create role authenticated;create role service_role bypassrls;
  create schema auth;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,last_sign_in_at timestamptz);
  create function auth.uid() returns uuid language sql as $$select null::uuid$$;
  create function auth.role() returns text language sql as $$select current_setting('request.jwt.claim.role',true)$$;
 `);
 const migrate=async(name:string)=>db.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
 await migrate('202609160001_secure_beta.sql');await migrate('202609160002_private_policy_helper.sql');
 await db.query('insert into auth.users values($1,$2,now(),now()),($3,$4,now(),now()),($5,$6,now(),now())',[admin,'linoramc@gmail.com',reader,'reader@example.test',third,'third@example.test']);
 await migrate('202609160003_pin_admin_identity.sql');await migrate('202611100001_portfolio_lab.sql');
 // Analytics only retires these existing columns; the complete monitoring
 // schema and collector are covered independently in monitoring-database.
 await db.exec('create table public.beta_monitor_alerts(id uuid primary key default gen_random_uuid(),enabled boolean not null,revision integer not null default 1,updated_at timestamptz not null default now());insert into public.beta_monitor_alerts(enabled) values(true),(false);');
 const state=createPortfolioState(10000,Date.parse('2026-11-10T15:00:00Z')),pid=randomUUID(),foreignPid=randomUUID();
 await db.query("insert into public.beta_paper_portfolios(id,user_id,creation_key,creation_hash,name,state) values($1,$2,$3,repeat('a',32),'Existing private portfolio',$4::jsonb),($5,$6,$7,repeat('b',32),'Other owner portfolio',$4::jsonb)",[pid,admin,randomUUID(),JSON.stringify(state),foreignPid,reader,randomUUID()]);
 const originalPortfolios=(await db.query('select * from public.beta_paper_portfolios order by id')).rows;
 await migrate('202611110002_analytics.sql');
 const rpc=async(operation:string,uid:string|null=reader,payload:Record<string,unknown>={})=>(await db.query('select public.beta_analytics_store($1,$2::uuid,$3::jsonb) result',[operation,uid,JSON.stringify(payload)])).rows[0].result as any;
 const portfolio=async(uid:string|null,pid:string|null=null)=>(await db.query('select public.beta_analytics_portfolio($1::uuid,$2::uuid) result',[uid,pid])).rows[0].result as any;
 const create=(uid=reader,name='My saved definition',requestId=randomUUID())=>rpc('save',uid,{name,query:definition,requestId});
 const legacyInput={name:'Deleted financial definition',query:definition,requestId:randomUUID()},legacy=await rpc('save',reader,legacyInput);
 await rpc('delete',reader,{id:legacy.id,revision:legacy.revision});
 await db.query("update public.beta_analytics_queries set deleted_at=now()-interval '31 days' where id=$1",[legacy.id]);
 await migrate('202611110003_analytics_retention.sql');

 await t.test('RLS and permissions deny all direct tables and browser RPCs while the service RPC remains usable',async()=>{
  assert.equal((await db.query("select relrowsecurity enabled from pg_class where oid='public.beta_analytics_queries'::regclass")).rows[0].enabled,true);
  for(const role of ['anon','authenticated','service_role']){
   await db.exec('set role '+role);
   try{
    for(const statement of ['select * from public.beta_analytics_queries','delete from public.beta_analytics_queries',"update public.beta_analytics_queries set name='Forged'"])
     await assert.rejects(db.query(statement),/permission denied/);
    await assert.rejects(db.query('select beta_private.analytics_compact_delete()'),/permission denied|trigger functions can only be called/);
    if(role==='service_role'){assert.deepEqual(await rpc('list'),[]);assert.equal((await portfolio(admin,pid)).id,pid);}
    else {await assert.rejects(rpc('list'),/permission denied/);await assert.rejects(portfolio(admin,pid),/permission denied/);}
   }finally{await db.exec('reset role');}
  }
  await assert.rejects(rpc('list',null),/BETA_ANALYTICS_FORBIDDEN/);
 });

 await t.test('retention migration compacts legacy definitions and writes remove expired receipts for that owner',async()=>{
  const compacted=(await db.query('select name,query,create_hash,deleted_at from public.beta_analytics_queries where id=$1',[legacy.id])).rows[0];
  assert.equal(compacted.name,'Consulta eliminada');assert.deepEqual(compacted.query,{version:1});assert.equal(typeof compacted.create_hash,'string');
  await assert.rejects(rpc('save',reader,legacyInput),/BETA_ANALYTICS_NOT_FOUND/);
  const next=await create(reader,'Trigger owner retention');await rpc('delete',reader,{id:next.id,revision:next.revision});
  assert.equal((await db.query('select count(*)::integer n from public.beta_analytics_queries where id=$1',[legacy.id])).rows[0].n,0);
 });

 await t.test('owned CRUD preserves create idempotency and compare-and-swap revisions without exposing another user',async()=>{
  const requestId=randomUUID(),input={name:'Owned comparison',query:definition,requestId},first=await rpc('save',reader,input);
  assert.equal(first.revision,1);assert.equal((await rpc('save',reader,input)).id,first.id);
  await assert.rejects(rpc('save',reader,{...input,name:'Different retry payload'}),/BETA_ANALYTICS_CONFLICT/);
  const independent=await create(third,'Third user comparison',requestId);assert.notEqual(independent.id,first.id);
  assert.deepEqual((await rpc('list',reader)).map((item:any)=>item.id),[first.id]);
  assert.deepEqual((await rpc('list',third)).map((item:any)=>item.id),[independent.id]);
  for(const operation of ['save','delete'])await assert.rejects(rpc(operation,third,{id:first.id,revision:first.revision,name:'Forged owner edit',query:definition}),/BETA_ANALYTICS_NOT_FOUND/);
  const updated=await rpc('save',reader,{id:first.id,revision:first.revision,name:'Updated comparison',query:{...definition,frequency:'weekly'}});
  assert.equal(updated.revision,2);assert.equal(updated.query.frequency,'weekly');
  await assert.rejects(rpc('save',reader,{id:first.id,revision:1,name:'Stale edit',query:definition}),/BETA_ANALYTICS_CONFLICT/);
  await assert.rejects(rpc('delete',reader,{id:first.id,revision:1}),/BETA_ANALYTICS_CONFLICT/);
  assert.equal((await rpc('list',reader))[0].name,'Updated comparison');
 });


 await t.test('delete removes only the owned active definition and retains a compact non-recreatable retry receipt',async()=>{
  const requestId=randomUUID(),input={name:'Delete and retry',query:definition,requestId},item=await rpc('save',reader,input);
  await rpc('delete',reader,{id:item.id,revision:item.revision});
  assert.ok(!(await rpc('list',reader)).some((row:any)=>row.id===item.id));
  const receipt=(await db.query('select * from public.beta_analytics_queries where id=$1',[item.id])).rows[0];
  assert.deepEqual(receipt.query,{version:1});assert.equal(receipt.name,'Consulta eliminada');assert.equal(receipt.revision,2);assert.ok(receipt.deleted_at);
  assert.ok(JSON.stringify(receipt).length<1000);assert.equal(JSON.stringify(receipt).includes('MSFT'),false);
  await assert.rejects(rpc('save',reader,input),/BETA_ANALYTICS_NOT_FOUND/);
  await assert.rejects(rpc('delete',reader,{id:item.id,revision:2}),/BETA_ANALYTICS_NOT_FOUND/);
  assert.ok((await rpc('list',third)).some((row:any)=>row.name==='Third user comparison'));
 });

 await t.test('active definitions are capped at one hundred and a deletion frees only that active slot',async()=>{
  const existing=(await rpc('list',third)).length;
  await db.query("insert into public.beta_analytics_queries(user_id,request_id,create_hash,name,query) select $1::uuid,gen_random_uuid(),repeat('c',32),'Capacity '||n,$2::jsonb from generate_series(1,$3::integer) n",[third,JSON.stringify(definition),99-existing]);
  const last=await create(third,'Last permitted active query');assert.equal((await rpc('list',third)).length,100);
  await assert.rejects(create(third,'Over capacity'),/BETA_ANALYTICS_LIMIT/);
  await rpc('delete',third,{id:last.id,revision:last.revision});
  await create(third,'Reused active slot');assert.equal((await rpc('list',third)).length,100);
 });

 await t.test('hundreds of compact deletion receipts stay bounded to five hundred without deleting active definitions or another owner',async()=>{
  const readerIds=(await db.query('select id from public.beta_analytics_queries where user_id=$1 order by id',[reader])).rows;
  await db.query("insert into public.beta_analytics_queries(user_id,request_id,create_hash,name,query,deleted_at) select $1::uuid,gen_random_uuid(),repeat('d',32),'Consulta eliminada','{\"version\":1}'::jsonb,now()+n*interval '1 microsecond' from generate_series(1,510) n",[third]);
  const counts=(await db.query('select count(*) filter(where deleted_at is null)::integer active,count(*) filter(where deleted_at is not null)::integer receipts from public.beta_analytics_queries where user_id=$1',[third])).rows[0];
  assert.equal(counts.active,100);assert.equal(counts.receipts,500);
  assert.deepEqual((await db.query('select id from public.beta_analytics_queries where user_id=$1 order by id',[reader])).rows,readerIds);
  assert.equal((await rpc('list',third)).length,100);
 });

 await t.test('revocation blocks both saved definitions and private portfolio reads',async()=>{
  await db.query('update public.beta_profiles set revoked=true where id=$1',[reader]);
  for(const operation of ['list','save','delete'])await assert.rejects(rpc(operation,reader,{}),/BETA_ANALYTICS_FORBIDDEN/);
  await db.query('update public.beta_profiles set revoked=false where id=$1',[reader]);
  await db.query('update public.beta_profiles set revoked=true where id=$1',[admin]);
  await assert.rejects(portfolio(admin,pid),/BETA_ANALYTICS_FORBIDDEN/);
  await db.query('update public.beta_profiles set revoked=false where id=$1',[admin]);
 });

 await t.test('portfolio reads require the pinned owner, reject foreign and archived IDs and never change existing operations',async()=>{
  assert.deepEqual((await portfolio(admin,pid)).state,state);assert.equal((await portfolio(admin)).id,pid);
  assert.equal(await portfolio(admin,foreignPid),null);
  await assert.rejects(portfolio(reader,foreignPid),/BETA_ANALYTICS_FORBIDDEN/);await assert.rejects(portfolio(third,pid),/BETA_ANALYTICS_FORBIDDEN/);
  await db.query('update public.beta_paper_portfolios set archived=true where id=$1',[pid]);
  assert.equal(await portfolio(admin,pid),null);await db.query('update public.beta_paper_portfolios set archived=false where id=$1',[pid]);
  assert.deepEqual((await db.query('select * from public.beta_paper_portfolios order by id')).rows,originalPortfolios);
 });

 await t.test('retired alert rows cannot be re-enabled or recreated as active after the Analytics migration',async()=>{
  const alerts=(await db.query('select * from public.beta_monitor_alerts')).rows;assert.ok(alerts.every((row:any)=>row.enabled===false));
  await assert.rejects(db.query('update public.beta_monitor_alerts set enabled=true where id=$1',[alerts[0].id]),/BETA_MONITOR_ALERTS_DISABLED/);
  await assert.rejects(db.query('insert into public.beta_monitor_alerts(enabled) values(true)'),/BETA_MONITOR_ALERTS_DISABLED/);
 });
});
