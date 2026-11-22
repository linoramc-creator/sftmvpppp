import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';import {randomUUID} from 'node:crypto';
const pg=await import(pathToFileURL(process.env.RESEARCH_PGLITE_MODULE??resolve('../../tools/research-pg/node_modules/@electric-sql/pglite/dist/index.js')).href).catch(()=>null);
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
test('personal codes enforce server-only lookup, versioned grants, expiry, RLS and committed throttles',{skip:pg?false:'PGlite unavailable'},async t=>{
 const db=new pg.PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,last_sign_in_at timestamptz);
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id));
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.uid',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('session_id',current_setting('request.sid',true))$$;
 create function auth.role() returns text language sql as $$select current_setting('request.role',true)$$;`);
 for(const file of ['202609160001_secure_beta.sql','202609160002_private_policy_helper.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 await db.query("insert into auth.users values($1,'linoramc@gmail.com',now(),now()),($2,'reader@example.test',now(),now())",[a,b]);
 await db.exec(await readFile(new URL('../supabase/migrations/202609160003_pin_admin_identity.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/202611220002_personal_access_codes.sql',import.meta.url),'utf8'));
 const store=async(operation:string,uid:string|null=a,payload:Record<string,unknown>={})=>(await db.query('select public.beta_access_store($1,$2::uuid,$3::jsonb) value',[operation,uid,JSON.stringify(payload)])).rows[0].value as any;
 const authorized=async(uid:string,sid:string)=>(await db.query('select public.beta_access_session($1::uuid,$2::uuid) value',[uid,sid])).rows[0].value;
 const sid=randomUUID(),otherSid=randomUUID();await db.query('insert into auth.sessions values($1,$2),($3,$4)',[sid,a,otherSid,b]);
 await t.test('activation preserves the exact account/admin and no old session receives a grant',async()=>{
  assert.deepEqual(await store('status'),{hasCode:false,pending:false});assert.equal(await authorized(a,sid),false);
  assert.equal(await store('find',null,{digest:'a'.repeat(64)}),null);
  assert.equal((await store('prepare',a,{digest:'a'.repeat(64)})).version,1);
  assert.equal((await store('status')).pending,true);
  await assert.rejects(store('grant',a,{digest:'a'.repeat(64),version:1,sessionId:sid}),/ACCESS_FORBIDDEN/);
  await store('activate',a,{digest:'a'.repeat(64),version:1});await store('grant',a,{digest:'a'.repeat(64),version:1,sessionId:sid});
  assert.equal(await authorized(a,sid),true);assert.equal(await authorized(b,sid),false);assert.equal(await authorized(a,otherSid),false);
  assert.equal((await db.query('select public.beta_is_admin($1) value',[a])).rows[0].value,true);
  assert.equal((await db.query('select count(*) count from auth.users')).rows[0].count,2);
 });
 await t.test('ungranted and foreign sessions cannot select reports directly through RLS',async()=>{
  await db.query("insert into public.beta_reports(user_id,kind,subject,payload) values($1,'ticker','AAPL','{}'),($2,'ticker','MSFT','{}')",[a,b]);
  await db.query("select set_config('request.uid',$1,false),set_config('request.sid',$2,false)",[a,sid]);
  await db.exec('set role authenticated');assert.equal((await db.query('select * from public.beta_reports')).rows.length,1);await db.exec('reset role');
  await db.query("select set_config('request.sid',$1,false)",[otherSid]);await db.exec('set role authenticated');assert.equal((await db.query('select * from public.beta_reports')).rows.length,0);await db.exec('reset role');
 });
 await t.test('rotation invalidates old code, old grants and in-flight grants for the previous version',async()=>{
  await assert.rejects(store('prepare',a,{digest:'b'.repeat(64),sessionId:otherSid}),/ACCESS_FORBIDDEN/);
  assert.equal((await store('prepare',a,{digest:'b'.repeat(64),sessionId:sid})).version,2);assert.equal(await authorized(a,sid),false);
  assert.equal(await store('find',null,{digest:'a'.repeat(64)}),null);
  await assert.rejects(store('grant',a,{digest:'a'.repeat(64),version:1,sessionId:sid}),/ACCESS_CHANGED/);
  await store('activate',a,{digest:'b'.repeat(64),version:2});await store('grant',a,{digest:'b'.repeat(64),version:2,sessionId:sid});
  assert.equal(await authorized(a,sid),true);
  await db.query("update beta_private.access_sessions set expires_at=now()-interval '1 second' where session_id=$1",[sid]);assert.equal(await authorized(a,sid),false);
  // Expiring interactive access never disables server-side background subscriptions.
  assert.equal((await db.query('select public.beta_active_user($1) value',[a])).rows[0].value,true);
 });
 await t.test('login failures retain counters and throttle even when IP values change',async()=>{
  const attempt=async(ip:string)=>(await db.query("select public.beta_access_attempt('login',$1,$2) value",[ip,'d'.repeat(64)])).rows[0].value;
  for(let i=0;i<10;i++)assert.equal(await attempt('c'.repeat(64)),true);
  assert.equal(await attempt('e'.repeat(64)),false);assert.equal(await attempt('f'.repeat(64)),false);
  assert.equal((await db.query("select count from public.beta_rate_buckets where bucket=$1",['access:key:login:'+'d'.repeat(64)])).rows[0].count,12);
 });
 await t.test('revocation and logout close access; direct code and grant access is denied to all clients',async()=>{
  await db.query('update beta_private.access_sessions set expires_at=now()+interval\'1 hour\' where session_id=$1',[sid]);
  await db.query('update public.beta_profiles set revoked=true where id=$1',[a]);assert.equal(await authorized(a,sid),false);assert.equal(await store('find',null,{digest:'b'.repeat(64)}),null);
  await db.query('update public.beta_profiles set revoked=false where id=$1',[a]);await store('logout',a,{sessionId:sid});assert.equal(await authorized(a,sid),false);
  for(const role of ['anon','authenticated']){await db.exec('set role '+role);try{await assert.rejects(store('find',null,{digest:'b'.repeat(64)}),/permission denied/);await assert.rejects(db.query('select * from beta_private.access_codes'),/permission denied/);await assert.rejects(db.query('select * from beta_private.access_sessions'),/permission denied/);await assert.rejects(authorized(a,sid),/permission denied/);}finally{await db.exec('reset role');}}
 });
});
