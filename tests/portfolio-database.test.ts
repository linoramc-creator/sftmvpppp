import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const pg=await import(pathToFileURL(process.env.RESEARCH_PGLITE_MODULE??resolve('../../tools/research-pg/node_modules/@electric-sql/pglite/dist/index.js')).href).catch(()=>null);
const admin='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const now=Date.UTC(2026,10,10,9);
const initialState=()=>({
 schema:1,currency:'USD',initialCash:10000,cash:10000,
 settings:{flatFee:1,slippageBps:5,reservationBufferBps:100},
 positions:[],orders:[],fills:[],events:[{id:randomUUID(),type:'created',at:now,note:'Cartera simulada.'}],snapshots:[],processedCommands:[],benchmark:null,
 performance:{returnFactor:1,lastEquity:10000,pendingFlow:0,peakFactor:1,maxDrawdownPct:0,historyTrimmed:false},
 lastAdvancedAt:null,createdAt:now,updatedAt:now,
});

// Isolated real PostgreSQL: no production connections, credentials or market
// calls. Run with Node or set RESEARCH_PGLITE_MODULE to a local PGlite module.
test('private portfolio PostgreSQL persistence enforces identity, bounded state, idempotency and CAS',{skip:pg?false:'Install @electric-sql/pglite or set RESEARCH_PGLITE_MODULE.'},async t=>{
 const db=new pg.PGlite();t.after(()=>db.close());
 await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role bypassrls;
  create schema auth;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,last_sign_in_at timestamptz);
  create function auth.uid() returns uuid language sql as $$select null::uuid$$;
 `);
 const migrate=async(name:string)=>db.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
 await migrate('202609160001_secure_beta.sql');
 await migrate('202609160002_private_policy_helper.sql');
 await db.query('insert into auth.users(id,email,email_confirmed_at,last_sign_in_at) values($1,$2,now(),now()),($3,$4,now(),now())',[admin,'linoramc@gmail.com',other,'tester@example.com']);
 await migrate('202609160003_pin_admin_identity.sql');
 await migrate('202610050001_feed_cache.sql');
 await migrate('202610200001_feed_preferences.sql');
 const legacyReportId=randomUUID(),legacyPayload={analysis:'Informe previo sin modificaciones.',quarterlyData:[],custom:{preserve:true}};
 await db.query("insert into public.beta_reports(id,user_id,kind,subject,payload) values($1,$2,'ticker','AAPL',$3)",[legacyReportId,other,JSON.stringify(legacyPayload)]);
 await db.query('insert into public.beta_feed_preferences(user_id,groups) values($1,$2)',[other,JSON.stringify({indices:['^GSPC'],etfs:['SPY'],currencies:['EURUSD=X']})]);
 const legacySnapshot=async()=>({
  profiles:(await db.query('select * from public.beta_profiles order by id')).rows,
  reports:(await db.query('select * from public.beta_reports order by id')).rows,
  preferences:(await db.query('select * from public.beta_feed_preferences order by user_id')).rows,
 });
 const before=await legacySnapshot();
 await migrate('202611100001_portfolio_lab.sql');
 await migrate('202611100003_portfolio_risk.sql');
 const rpc=async(operation:string,uid:string|null=admin,pid:string|null=null,version:number|null=null,payload:unknown=null)=>(await db.query('select public.beta_portfolio_store($1,$2::uuid,$3::uuid,$4::integer,$5::jsonb) result',[operation,uid,pid,version,payload===null?null:JSON.stringify(payload)])).rows[0].result as any;
 const create=(name:string,requestId=randomUUID(),state:any=initialState())=>rpc('create',admin,null,null,{name,state,requestId});
 const count=async()=>(await db.query('select count(*)::integer n from public.beta_paper_portfolios where user_id=$1',[admin])).rows[0].n;
 const activeCount=async()=>(await db.query('select count(*)::integer n from public.beta_paper_portfolios where user_id=$1 and not archived',[admin])).rows[0].n;
 let first:any,second:any,third:any;

 await t.test('only the service RPC is callable; all direct reads, writes and helpers remain private',async()=>{
  for(const role of ['anon','authenticated','service_role']){
   await db.exec('set role '+role);
   for(const query of ['select * from public.beta_paper_portfolios','delete from public.beta_paper_portfolios','update public.beta_paper_portfolios set name=\'Forged\''])await assert.rejects(db.query(query),/permission denied/);
   await assert.rejects(db.query('select * from public.beta_portfolio_rename_requests'),/permission denied/);
   await assert.rejects(db.query("select beta_private.portfolio_store_v1('list',$1::uuid)",[admin]),/permission denied/);
   await assert.rejects(db.query('insert into public.beta_paper_portfolios default values'),/permission denied/);
   await assert.rejects(db.query('select beta_private.portfolio_state_valid($1::jsonb)',[JSON.stringify(initialState())]),/permission denied/);
   if(role!=='service_role'){
    await assert.rejects(rpc('list'),/permission denied/);
    await assert.rejects(rpc('due',null),/permission denied/);
   }else{
    assert.deepEqual(await rpc('list'),[]);
    assert.deepEqual(await rpc('due',null),[]);
    await assert.rejects(rpc('list',other),/BETA_PORTFOLIO_FORBIDDEN/);
   }
   await db.exec('reset role');
  }
  const security=(await db.query("select relrowsecurity from pg_class where oid='public.beta_paper_portfolios'::regclass")).rows[0];assert.equal(security.relrowsecurity,true);
  assert.equal((await db.query("select count(*)::integer n from pg_policies where tablename='beta_paper_portfolios'")).rows[0].n,0);
 });

 await t.test('creation validates names, UUID intent, state types, currency, cash and size before storing',async()=>{
  const state=initialState();
  const states:any[]=[null,{},[],{...state,schema:2},{...state,schema:'1'},{...state,schema:null},{...state,currency:'EUR'},{...state,currency:null},
   {...state,initialCash:0},{...state,initialCash:10000001},{...state,initialCash:'10000'},{...state,cash:-1000000000000001},{...state,cash:'NaN'},
   {...state,cash:Number.POSITIVE_INFINITY},{...state,createdAt:now+.5},{...state,updatedAt:now-1},{...state,settings:null},{...state,orders:{}},
   {...state,positions:Array.from({length:21},()=>({symbol:'AAPL',quantity:1}))},{...state,positions:[{symbol:'AAPL',quantity:0}]},
   {...state,positions:[{symbol:'AAPL',quantity:'1'}]},{...state,positions:[{symbol:'../AAPL',quantity:1}]},
   {...state,orders:Array(5001).fill({})},{...state,fills:Array(5001).fill({})},{...state,events:Array(10001).fill({})},
   {...state,snapshots:Array(10001).fill({})},{...state,processedCommands:Array(101).fill({})},{...state,extra:'x'.repeat(1048576)},
  ];
  for(const invalid of states)await assert.rejects(create('Prueba inválida',randomUUID(),invalid),/BETA_PORTFOLIO_INVALID/);
  const valid={name:'Prueba',state,requestId:randomUUID()};
  for(const payload of [null,{},[],{...valid,name:''},{...valid,name:'x'.repeat(61)},{...valid,name:'<script>'},{...valid,name:'Fila\nNueva'},
   {...valid,requestId:'not-a-uuid'},{name:valid.name,state},{...valid,id:randomUUID()},{...valid,userId:other},
  ])await assert.rejects(rpc('create',admin,null,null,payload),/BETA_PORTFOLIO_INVALID/);
  await assert.rejects(rpc('create',admin,randomUUID(),null,valid),/BETA_PORTFOLIO_INVALID/);
  assert.equal(await count(),0);
 });

 await t.test('repeated creation has one server UUID even when regenerated engine timestamps differ',async()=>{
  const requestId=randomUUID(),state=initialState();
  const results=await Promise.all([create('Principal',requestId,state),create('Principal',requestId,{...state,createdAt:now+1000,updatedAt:now+1000,events:[],snapshots:[]})]);
  first=results[0];assert.equal(results[1].id,first.id);assert.notEqual(first.id,requestId);assert.notEqual(first.id,admin);assert.equal(first.version,1);assert.equal(first.archived,false);assert.equal(first.name,'Principal');
  assert.deepEqual(first.state,state);assert.ok(Number.isFinite(Date.parse(first.createdAt)));assert.ok(Number.isFinite(Date.parse(first.updatedAt)));assert.deepEqual(Object.keys(first).sort(),['id','name','state','version','archived','createdAt','updatedAt'].sort());
  assert.equal(await count(),1);
  await assert.rejects(create('Otro nombre',requestId,state),/BETA_PORTFOLIO_CONFLICT/);
  await assert.rejects(create('Principal',requestId,{...state,initialCash:20000,cash:20000}),/BETA_PORTFOLIO_CONFLICT/);
  await assert.rejects(create('Principal',requestId,{...state,settings:{...state.settings,flatFee:2}}),/BETA_PORTFOLIO_CONFLICT/);
  assert.equal(await count(),1);
 });

 await t.test('ownership and compare-and-swap reject foreign records, stale writes and altered origin fields',async()=>{
  assert.deepEqual(await rpc('get',admin,first.id),first);
  for(const op of ['list','get','create','save','archive','restore','rename'])await assert.rejects(rpc(op,other,first.id,first.version,{name:'Foreign',state:initialState(),requestId:randomUUID()}),/BETA_PORTFOLIO_FORBIDDEN/);
  const foreignId=randomUUID();
  await db.query('insert into public.beta_paper_portfolios(id,user_id,creation_key,creation_hash,name,state) values($1,$2,$3,$4,$5,$6::jsonb)',[foreignId,other,randomUUID(),'a'.repeat(32),'Ajena',JSON.stringify(initialState())]);
  for(const op of ['get','save','archive','restore','rename'])await assert.rejects(rpc(op,admin,foreignId,1,op==='rename'?{name:'Foreign',requestId:randomUUID()}:{state:initialState()}),/BETA_PORTFOLIO_NOT_FOUND/);
  await assert.rejects(rpc('get',null,first.id),/BETA_PORTFOLIO_FORBIDDEN/);
  await assert.rejects(rpc('save',admin,first.id,99,{state:first.state}),/BETA_PORTFOLIO_CONFLICT/);
  for(const state of [{...first.state,initialCash:10001},{...first.state,createdAt:now-1},{...first.state,updatedAt:now-1},{...first.state,currency:'EUR'}])await assert.rejects(rpc('save',admin,first.id,1,{state}),/BETA_PORTFOLIO_INVALID/);
  for(const payload of [{state:first.state,name:null},{state:first.state,name:' '},{state:first.state,id:randomUUID()},{}])await assert.rejects(rpc('save',admin,first.id,1,payload),/BETA_PORTFOLIO_INVALID/);
  const updated={...first.state,cash:10500,updatedAt:now+2000,events:[...first.state.events,{id:randomUUID(),type:'deposit',at:now+2000,amount:500,note:'Aportación.'}]};
  const results=await Promise.allSettled([rpc('save',admin,first.id,1,{name:'Principal revisada',state:updated}),rpc('save',admin,first.id,1,{name:'Edición concurrente',state:updated})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected'&&/BETA_PORTFOLIO_CONFLICT/.test(String(r.reason))).length,1);
  first=(results.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<any>).value;assert.equal(first.version,2);assert.deepEqual(first.state,updated);assert.equal((await rpc('list')).length,1);
  const row=(await db.query('select user_id,creation_key,created_at from public.beta_paper_portfolios where id=$1',[first.id])).rows[0];assert.equal(row.user_id,admin);
  const replay=await create('Principal',row.creation_key,{...initialState(),createdAt:now+3000,updatedAt:now+3000});assert.equal(replay.id,first.id);assert.equal(replay.version,2);assert.deepEqual(replay.state,updated);
 });

 await t.test('archiving preserves accounting, restores with CAS and enforces three active portfolios atomically',async()=>{
  second=await create('Segunda');third=await create('Tercera');assert.equal(await activeCount(),3);
  await assert.rejects(create('Cuarta'),/BETA_PORTFOLIO_ACTIVE_LIMIT/);
  const frozen=first.state;
  first=await rpc('archive',admin,first.id,first.version,{requestId:randomUUID()});assert.equal(first.archived,true);assert.equal(first.version,3);assert.deepEqual(first.state,frozen);
  assert.deepEqual((await rpc('get',admin,first.id)).state,frozen);assert.equal((await rpc('list')).length,3);assert.equal((await rpc('list')).at(-1).id,first.id);
  await assert.rejects(rpc('save',admin,first.id,first.version,{state:first.state}),/BETA_PORTFOLIO_ARCHIVED/);
  assert.equal((await rpc('archive',admin,first.id,first.version)).version,first.version);
  const fourth=await create('Cuarta');assert.equal(await activeCount(),3);
  await assert.rejects(rpc('restore',admin,first.id,first.version),/BETA_PORTFOLIO_ACTIVE_LIMIT/);
  await rpc('archive',admin,fourth.id,fourth.version);
  await assert.rejects(rpc('restore',admin,first.id,1),/BETA_PORTFOLIO_CONFLICT/);
  first=await rpc('restore',admin,first.id,first.version);assert.equal(first.archived,false);assert.equal(first.version,4);assert.deepEqual(first.state,frozen);
  assert.equal((await rpc('restore',admin,first.id,first.version)).version,first.version);
  second=await rpc('archive',admin,second.id,second.version);
  const results=await Promise.allSettled([create('Capacidad A'),create('Capacidad B')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected'&&/BETA_PORTFOLIO_ACTIVE_LIMIT/.test(String(r.reason))).length,1);assert.equal(await activeCount(),3);
  const due=await rpc('due',null);assert.equal(due.length,3);assert.ok(due.every((p:any)=>p.userId===admin&&!p.archived));assert.ok(!due.some((p:any)=>p.id===second.id));
  await assert.rejects(rpc('due',admin),/BETA_PORTFOLIO_INVALID/);
 });

 await t.test('each operation and due recheck current admin, revocation, confirmation and actual account email',async()=>{
  const ordinary=[()=>rpc('list'),()=>rpc('get',admin,first.id),()=>create('No autorizada'),()=>rpc('save',admin,first.id,first.version,{state:first.state}),()=>rpc('archive',admin,first.id,first.version),()=>rpc('restore',admin,second.id,second.version),()=>rpc('rename',admin,first.id,first.version,{name:'No autorizada',requestId:randomUUID()})];
  const denied=async()=>{for(const operation of ordinary)await assert.rejects(operation(),/BETA_PORTFOLIO_FORBIDDEN/);assert.deepEqual(await rpc('due',null),[]);};
  await db.query('update public.beta_profiles set revoked=true where id=$1',[admin]);await denied();await db.query('update public.beta_profiles set revoked=false where id=$1',[admin]);
  await db.query('update auth.users set email_confirmed_at=null where id=$1',[admin]);await denied();await db.query('update auth.users set email_confirmed_at=now() where id=$1',[admin]);
  await db.query('delete from beta_private.admin_users where user_id=$1',[admin]);await denied();await db.query('insert into beta_private.admin_users(user_id) values($1)',[admin]);
  await db.query('update auth.users set email=$2 where id=$1',[admin,'changed@example.com']);await denied();await db.query('update auth.users set email=$2 where id=$1',[admin,'linoramc@gmail.com']);
  assert.equal((await rpc('list')).length,await count());assert.equal((await rpc('due',null)).length,3);
 });

 await t.test('renaming is metadata-only, owner bound, versioned and permanently idempotent across later names',async()=>{
  const requestId=randomUUID(),state=structuredClone(first.state),createdAt=first.createdAt,version=first.version;
  const results=await Promise.all([rpc('rename',admin,first.id,version,{name:'Estrategia principal',requestId}),rpc('rename',admin,first.id,version,{name:'Estrategia principal',requestId})]);
  first=results[0];assert.equal(first.version,version+1);assert.equal(results[1].version,first.version);assert.equal(first.name,'Estrategia principal');assert.equal(first.createdAt,createdAt);assert.deepEqual(first.state,state);
  await assert.rejects(rpc('rename',admin,first.id,version,{name:'Nombre distinto',requestId}),/BETA_PORTFOLIO_CONFLICT/);
  await assert.rejects(rpc('rename',admin,second.id,second.version,{name:'Estrategia principal',requestId}),/BETA_PORTFOLIO_CONFLICT/);
  await assert.rejects(rpc('rename',admin,first.id,version,{name:'Versión obsoleta',requestId:randomUUID()}),/BETA_PORTFOLIO_CONFLICT/);
  for(const payload of [{name:' ',requestId:randomUUID()},{name:'x'.repeat(61),requestId:randomUUID()},{name:'<script>',requestId:randomUUID()},{name:'Con\nSalto',requestId:randomUUID()},{name:'Sin UUID'},{name:'X',requestId:'bad'},{name:'X',requestId:randomUUID(),state}])await assert.rejects(rpc('rename',admin,first.id,first.version,payload),/BETA_PORTFOLIO_INVALID/);
  first=await rpc('rename',admin,first.id,first.version,{name:'Nombre vigente',requestId:randomUUID()});
  const replay=await rpc('rename',admin,first.id,version,{name:'Estrategia principal',requestId});assert.equal(replay.name,'Nombre vigente');assert.equal(replay.version,first.version);assert.deepEqual(replay.state,state);
  const archivedState=structuredClone(second.state),archived=await rpc('rename',admin,second.id,second.version,{name:'Archivo renombrado',requestId:randomUUID()});second=archived;assert.equal(archived.archived,true);assert.deepEqual(archived.state,archivedState);
 });

 await t.test('signed short liabilities and forced-close debt persist without weakening shape or finite bounds',async()=>{
  const signed={...first.state,cash:-250,updatedAt:first.state.updatedAt+1000,positions:[{symbol:'AAPL',name:'Apple',quantity:-2,averageCost:100,costBasis:-200,shortProceeds:200,realizedPnl:0,dividends:0}]};
  first=await rpc('save',admin,first.id,first.version,{state:signed});assert.equal(first.state.cash,-250);assert.equal(first.state.positions[0].quantity,-2);
  for(const positions of [[{...signed.positions[0],quantity:0}],[{...signed.positions[0],costBasis:200}],[{...signed.positions[0],shortProceeds:-1}]])await assert.rejects(rpc('save',admin,first.id,first.version,{state:{...signed,positions}}),/BETA_PORTFOLIO_INVALID/);
 });

 await t.test('fifty stored records is a hard owner cap; legacy reports, preferences and users are preserved',async()=>{
  const remaining=50-Number(await count());
  await db.query(`insert into public.beta_paper_portfolios(user_id,creation_key,creation_hash,name,state,archived)
   select $1::uuid,gen_random_uuid(),repeat('b',32),'Archivo '||n,$2::jsonb,true from generate_series(1,$3::integer) n`,[admin,JSON.stringify(initialState()),remaining]);
  assert.equal(await count(),50);
  const listed=await rpc('list');assert.equal(listed.length,50);
  assert.ok(listed.every((p:any)=>!('state' in p)));
  assert.deepEqual(Object.keys(listed[0]).sort(),['id','name','version','archived','createdAt','updatedAt'].sort());
  assert.deepEqual((await rpc('get',admin,first.id)).state,first.state);
  assert.ok((await rpc('due',null)).every((p:any)=>p.state.schema===1));
  first=await rpc('archive',admin,first.id,first.version);assert.equal(await activeCount(),2);
  await assert.rejects(create('Más de cincuenta'),/BETA_PORTFOLIO_STORAGE_LIMIT/);
  assert.equal((await rpc('due',null)).length,2);
  assert.deepEqual(await legacySnapshot(),before);
  assert.equal((await db.query('select payload from public.beta_reports where id=$1',[legacyReportId])).rows[0].payload.analysis,legacyPayload.analysis);
 });
});
