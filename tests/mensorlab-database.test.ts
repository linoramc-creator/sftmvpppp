import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {LabDefinition,LabRun} from '../supabase/functions/analyze-ticker/mensorlab-types.ts';
const pg=await import(pathToFileURL(process.env.RESEARCH_PGLITE_MODULE??resolve('../../tools/research-pg/node_modules/@electric-sql/pglite/dist/index.js')).href).catch(()=>null);
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const definition:LabDefinition={version:1,studies:[{id:'comparison',name:'Comparación',kind:'comparison',query:{version:1,assets:['MSFT','SPY'],metric:'price',operation:'base100',period:{range:'1y'},frequency:'daily',currency:'USD',chart:'line',dataKind:'reported'}}]};
const evidence=():LabRun=>({runId:randomUUID(),definition,generatedAt:new Date().toISOString(),results:[],status:'unavailable',warnings:['Synthetic database fixture']});
test('MensorLab PostgreSQL isolates projects, freezes server results and enforces revision/idempotency/retention',{skip:pg?false:'PGlite unavailable'},async t=>{
 const db=new pg.PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,last_sign_in_at timestamptz);
 create function auth.uid() returns uuid language sql as $$select null::uuid$$;
 create function auth.role() returns text language sql as $$select current_setting('request.jwt.claim.role',true)$$;`);
 for(const migration of ['202609160001_secure_beta.sql','202609160002_private_policy_helper.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+migration,import.meta.url),'utf8'));
 await db.query('insert into auth.users values($1,$2,now(),now()),($3,$4,now(),now())',[owner,'lab-owner@example.test',other,'lab-other@example.test']);
 // A trading-table sentinel demonstrates that migrations and every operation
 // leave unrelated financial records intact.
 await db.exec("create table public.beta_paper_portfolios(id uuid primary key,state jsonb);insert into public.beta_paper_portfolios values(gen_random_uuid(),'{\"cash\":1234,\"positions\":[{\"symbol\":\"MSFT\",\"quantity\":3}]}'::jsonb);");
 const before=(await db.query('select * from public.beta_paper_portfolios')).rows;
 await db.exec(await readFile(new URL('../supabase/migrations/202611160001_mensorlab.sql',import.meta.url),'utf8'));
 const rpc=async(operation:string,uid:string|null=owner,payload:Record<string,unknown>={})=>(await db.query('select public.beta_mensorlab_store($1,$2::uuid,$3::jsonb) result',[operation,uid,JSON.stringify(payload)])).rows[0].result as any;
 const save=async(name='Proyecto',uid=owner)=>{const run=evidence();await rpc('putRun',uid,{run});return rpc('save',uid,{name,runId:run.runId,requestId:randomUUID()});};
 let project:any;
 await t.test('browsers and direct service table writes are denied; only server RPC can persist evidence',async()=>{
  for(const table of ['projects','snapshots','runs','receipts'])assert.equal((await db.query("select relrowsecurity enabled from pg_class where oid=$1::regclass",['public.beta_lab_'+table])).rows[0].enabled,true);
  for(const role of ['anon','authenticated','service_role']){
   await db.exec('set role '+role);
   try{for(const table of ['projects','snapshots','runs','receipts'])await assert.rejects(db.query('select * from public.beta_lab_'+table),/permission denied/);
    await assert.rejects(db.query('select beta_private.mensorlab_project($1,$2)',[owner,randomUUID()]),/permission denied/);
    if(role==='service_role')assert.deepEqual(await rpc('list'),[]);else await assert.rejects(rpc('list'),/permission denied/);
   }finally{await db.exec('reset role');}
  }
  await assert.rejects(rpc('list',null),/BETA_LAB_FORBIDDEN/);
 });
 await t.test('private run cannot be saved by another owner; save replay is idempotent with immutable evidence',async()=>{
  const run=evidence(),requestId=randomUUID();await rpc('putRun',owner,{run});
  await assert.rejects(rpc('save',other,{name:'Stolen',runId:run.runId,requestId}),/BETA_LAB_RUN_EXPIRED/);
  const input={name:'Mi proyecto',runId:run.runId,requestId};project=await rpc('save',owner,input);
  assert.equal(project.revision,1);assert.equal(project.snapshot_count,1);assert.deepEqual(project.snapshots[0].run,run);
  assert.equal((await rpc('save',owner,input)).id,project.id);assert.equal((await rpc('save',owner,input)).snapshot_count,1);
  await assert.rejects(rpc('save',owner,{...input,name:'Mutated retry'}),/BETA_LAB_CONFLICT/);
  assert.equal((await rpc('list',owner))[0].study_count,1);assert.deepEqual(await rpc('list',other),[]);
  await assert.rejects(rpc('open',other,{id:project.id}),/BETA_LAB_NOT_FOUND/);
  await assert.rejects(rpc('open',owner,{id:project.id,snapshotId:randomUUID()}),/BETA_LAB_NOT_FOUND/);
 });
 await t.test('retained owned evidence remains saveable after temporary cache expires without recomputation',async()=>{
  const firstSnapshot=project.snapshots[0],input={id:project.id,revision:project.revision,name:'Renamed exact result',runId:firstSnapshot.run.runId,requestId:randomUUID()};
  await db.query("update public.beta_lab_runs set expires_at=now()-interval '1 hour' where user_id=$1",[owner]);
  project=await rpc('save',owner,input);assert.equal(project.revision,2);assert.equal(project.snapshot_count,1);assert.deepEqual(project.snapshots[0],firstSnapshot);
  await assert.rejects(rpc('save',owner,{...input,requestId:randomUUID()}),/BETA_LAB_CONFLICT/);
  const copy=await rpc('save',owner,{name:'Independent copy',runId:firstSnapshot.run.runId,requestId:randomUUID()});assert.notEqual(copy.id,project.id);assert.deepEqual(copy.snapshots[0].run,firstSnapshot.run);
 });
 await t.test('refresh is revision checked and receipt reuse cannot create duplicate snapshots',async()=>{
  const run=evidence(),requestId=randomUUID(),input={id:project.id,revision:project.revision,requestId,run};
  assert.equal(await rpc('receipt',owner,{id:project.id,revision:project.revision,requestId,action:'refresh'}),null);
  const old=project.snapshots[0];project=await rpc('refresh',owner,input);assert.equal(project.revision,3);assert.equal(project.snapshot_count,2);assert.deepEqual(project.snapshots.find((s:any)=>s.id===old.id),old);
  assert.equal((await rpc('refresh',owner,input)).revision,3);assert.equal((await rpc('refresh',owner,input)).snapshot_count,2);
  assert.equal((await rpc('receipt',owner,{id:project.id,revision:2,requestId,action:'refresh'})).id,project.id);
  await assert.rejects(rpc('refresh',other,{...input,requestId:randomUUID()}),/BETA_LAB_NOT_FOUND/);
  await assert.rejects(rpc('refresh',owner,{...input,requestId:randomUUID()}),/BETA_LAB_CONFLICT/);
  await assert.rejects(rpc('refresh',owner,{id:project.id,revision:project.revision,requestId:randomUUID(),run:{...evidence(),definition:{version:1,studies:[]}}}),/BETA_LAB_INVALID/);
  project=await rpc('save',owner,{id:project.id,revision:project.revision,name:project.name,runId:old.run.runId,requestId:randomUUID()});
  assert.deepEqual(project.definition,project.snapshots[0].run.definition);assert.deepEqual(project.snapshots[0].run,old.run);assert.equal(project.snapshot_count,3);
 });
 await t.test('refresh keeps only newest ten immutable snapshots; temporary runs stay bounded and expire',async()=>{
  for(let i=0;i<12;i++)project=await rpc('refresh',owner,{id:project.id,revision:project.revision,requestId:randomUUID(),run:evidence()});
  assert.equal(project.snapshot_count,10);assert.equal(project.snapshots.length,10);
  for(let i=0;i<14;i++)await rpc('putRun',owner,{run:evidence()});
  assert.equal((await db.query('select count(*)::int n from public.beta_lab_runs where user_id=$1',[owner])).rows[0].n,10);
  const expired=evidence();await rpc('putRun',other,{run:expired});await db.query("update public.beta_lab_runs set expires_at=now()-interval '1 second' where id=$1",[expired.runId]);
  await assert.rejects(rpc('save',other,{name:'Expired unsaved',runId:expired.runId,requestId:randomUUID()}),/BETA_LAB_RUN_EXPIRED/);
 });
 await t.test('revoked users are blocked and project limits/delete do not alter trading operations',async()=>{
  await db.query('update public.beta_profiles set revoked=true where id=$1',[owner]);await assert.rejects(rpc('list'),/BETA_LAB_FORBIDDEN/);await db.query('update public.beta_profiles set revoked=false where id=$1',[owner]);
  for(let i=(await rpc('list')).length;i<20;i++)await save('Capacity '+i);
  await assert.rejects(save('Over limit'),/BETA_LAB_LIMIT/);
  const foreign=await save('Other project',other);
  await assert.rejects(rpc('delete',other,{id:project.id,revision:project.revision}),/BETA_LAB_NOT_FOUND/);
  const requestId=randomUUID(),input={id:project.id,revision:project.revision,requestId};await rpc('delete',owner,input);assert.deepEqual(await rpc('delete',owner,input),{ok:true});
  assert.equal((await db.query('select count(*)::int n from public.beta_lab_snapshots where project_id=$1',[project.id])).rows[0].n,0);
  await assert.rejects(rpc('open',owner,{id:project.id}),/BETA_LAB_NOT_FOUND/);assert.equal((await rpc('open',other,{id:foreign.id})).id,foreign.id);
  await save('Freed slot');assert.equal((await rpc('list')).length,20);
  assert.deepEqual((await db.query('select * from public.beta_paper_portfolios')).rows,before);
 });
});
