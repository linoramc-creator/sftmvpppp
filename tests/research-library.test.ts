import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {handleResearchAction,readResearchDetail,ResearchError,type ResearchDependencies} from '../supabase/functions/analyze-ticker/research-library.ts';
import {classify,readBody} from '../supabase/functions/analyze-ticker/beta-security.ts';
import type {ResearchSnapshot,ResearchDiff} from '../supabase/functions/analyze-ticker/research-types.ts';

const uid='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333';
const requestId='44444444-4444-4444-8444-444444444444';
const snapshot=(price=100):ResearchSnapshot=>({schema:1,kind:'ticker',subject:'NEW',capturedAt:'2026-10-26T12:00:00Z',quality:'complete',assets:[{symbol:'NEW',name:'New company',price,currency:'USD',quoteAt:'2026-10-23T20:00:00Z',description:null}],metrics:[],series:[],news:[],sections:[],coverage:[],settings:{}});
const saveBody=(extra:any={})=>({accountAction:'researchSave',requestId,kind:'ticker',subject:'NEW',payload:{analysis:'Original investment report.',quarterlyData:[]},...extra});

test('research operations enforce paid-work budgets, strict identities and bounded bodies before providers run',async()=>{
 for(const body of [saveBody(),{accountAction:'researchCheck',id:uid},{accountAction:'researchSummary',id:uid,versionId:other},{accountAction:'researchExplain',id:uid,reviewId:other}])assert.equal(classify(body).request_class,'expensive');
 for(const accountAction of ['researchList','researchGet','researchDelete','researchRestore'])assert.equal(classify({accountAction,id:uid}).request_class,'account');
 for(const body of [{...saveBody(),requestId:'wrong'},{...saveBody(),payload:{analysis:'a',quarterlyData:[],etfDeep:'ignored'},settings:{api_key:'bad'}},{...saveBody(),settings:{symbols:['AAPL',' aapl ']}},{accountAction:'researchGet',id:uid,versionId:'../secret'},{accountAction:'researchMagic',id:uid},{accountAction:'researchCheck',id:uid,marketData:true},{accountAction:'researchMeta',id:uid,expectedRevision:0},{accountAction:'researchMeta',id:uid,expectedRevision:1,next_review:'2026-02-30'},{accountAction:'researchSave',...saveBody(),payload:{analysis:'😀'.repeat(260000),quarterlyData:[]}}])assert.throws(()=>classify(body));
 const post=(body:unknown)=>new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 await readBody(post(saveBody({payload:{analysis:'a'.repeat(600000),quarterlyData:[]}})));
 await assert.rejects(readBody(post({accountAction:'profile',notes:'a'.repeat(5000)})));
 await assert.rejects(readBody(post(saveBody({payload:{analysis:'a'.repeat(1020000),quarterlyData:[]}}))));
});

// This is a real isolated PostgreSQL engine, not a mocked implementation of the
// migration. Install @electric-sql/pglite locally or set RESEARCH_PGLITE_MODULE.
const pg=await import(pathToFileURL(process.env.RESEARCH_PGLITE_MODULE??resolve('../../tools/research-pg/node_modules/@electric-sql/pglite/dist/index.js')).href).catch(()=>null);
test('research PostgreSQL transactions preserve archives, versions, ownership and concurrent edits',{skip:pg?false:'Install @electric-sql/pglite or set RESEARCH_PGLITE_MODULE to run isolated SQL integration tests.'},async t=>{
 const db=new pg.PGlite();t.after(()=>db.close());
 await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql as $$select null::uuid$$;");
 await db.exec(await readFile(new URL('../supabase/migrations/202609160001_secure_beta.sql',import.meta.url),'utf8'));
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now()),($3,$4,now())',[uid,'owner@example.com',other,'other@example.com']);
 const legacyIds=[randomUUID(),randomUUID()],legacyPayload={analysis:'Historic AAPL report, unchanged.',quarterlyData:[],customArchiveField:{preserve:true}};
 await db.query("insert into public.beta_reports(id,user_id,kind,subject,payload,saved_at) values($1,$2,'ticker','AAPL',$3,'2026-10-20T12:00Z'),($4,$2,'ticker','aapl',$3,'2026-10-21T12:00Z')",[legacyIds[0],uid,JSON.stringify(legacyPayload),legacyIds[1]]);
 await db.exec(await readFile(new URL('../supabase/migrations/202610260002_research_library.sql',import.meta.url),'utf8'));
 let captures=0,price=100,aiCalls=0,captureFailure=false;
 const calls:string[]=[];
 const service=async(path:string)=>{
  calls.push(path);const url=new URL('https://local/'+path),table=url.pathname.slice(1),params:any[]=[],conditions:string[]=[];
  assert.ok(['beta_research_items','beta_research_versions','beta_research_reviews'].includes(table));assert.ok(url.searchParams.has('user_id'),'Every API table read must bind the owner');
  for(const[key,value]of url.searchParams)if(!['select','order','limit'].includes(key)){assert.match(key,/^[a-z_]+$/);assert.ok(value.startsWith('eq.'));params.push(value.slice(3));conditions.push(`${key}=$${params.length}`);}
  const select=url.searchParams.get('select')??'*';assert.match(select,/^(?:\*|[a-z_,]+)$/);
  const order=(url.searchParams.get('order')??'').split(',').filter(Boolean).map(value=>{assert.match(value,/^[a-z_]+\.(?:asc|desc)$/);return value.replace('.',' ');}).join(',');
  const rows=(await db.query(`select ${select} from public.${table} where ${conditions.join(' and ')}${order?' order by '+order:''} limit ${Number(url.searchParams.get('limit')??100)}`,params)).rows;
  return JSON.parse(JSON.stringify(rows));
 };
 const rpc=async(name:string,body:any)=>{
  assert.match(name,/^beta_research_[a-z_]+$/);const keys=Object.keys(body);keys.forEach(key=>assert.match(key,/^[a-z_]+$/));
  try{return(await db.query(`select public.${name}(${keys.map((key,i)=>`${key}=>$${i+1}`).join(',')}) as value`,keys.map(key=>typeof body[key]==='object'&&body[key]!==null?JSON.stringify(body[key]):body[key]))).rows[0].value;}
  catch(error){const message=(error as Error).message;throw new ResearchError(message.includes('NOT_FOUND')?404:/CONFLICT|BUSY|LIMIT|DELETED/.test(message)?409:400,message);}
 };
 const compare=(baseline:ResearchSnapshot,current:ResearchSnapshot):ResearchDiff=>{
  const before=baseline.assets[0]?.price??0,after=current.assets[0]?.price??0,material=Math.abs(after-before)>=5;
  return {fingerprint:`price-${before}-${after}`,checkedAt:current.capturedAt,baselineAt:baseline.capturedAt,comparable:true,changes:material?[{id:'price',category:'price',label:'Precio',importance:'high',before:String(before),after:String(after),detail:'Actual price change.'}]:[],material,performance:[],note:''};
 };
 const deps:ResearchDependencies={service,rpc,env:key=>({GEMINI_API_KEY:'test-key',BRIEF_FROM:'terminal@example.com',BRIEF_RESEND_API_KEY:'test-mail'} as Record<string,string>)[key]??'',capture:async()=>{captures++;await Promise.resolve();if(captureFailure){captureFailure=false;throw new ResearchError(503,'Capture unavailable');}return snapshot(price);},compare,explain:async()=>{aiCalls++;return 'Only the stored differences.';},summarize:async()=>{aiCalls++;return 'Only the archived report.';}};
 const action=async(body:any,userId=uid)=>{const response=await handleResearchAction(body,{id:userId},deps);assert.ok(response);return response!.json();};
 let detail:any;
 await t.test('legacy import groups subjects and preserves every original payload and save date without capture',async()=>{
  const result=await action({accountAction:'researchList'});assert.equal(result.items.length,1);assert.equal(result.items[0].latest_version,2);assert.equal(captures,0);
  const itemId=result.items[0].id,archived=await action({accountAction:'researchGet',id:itemId});assert.equal(archived.versions.length,2);assert.deepEqual(archived.version.payload,legacyPayload);assert.equal(archived.version.snapshot.quality,'legacy');assert.ok(archived.version.created_at.startsWith('2026-10-21'));assert.ok(archived.version.snapshot.capturedAt.startsWith('2026-10-21'));
  await action({accountAction:'researchList'});assert.equal((await db.query('select count(*) as n from public.beta_research_versions')).rows[0].n,2);assert.equal((await db.query('select count(*) as n from public.beta_reports')).rows[0].n,2);
 });
 await t.test('request claims prevent duplicate captures and versions during retries and reject reused IDs with different content',async()=>{
  const results=await Promise.allSettled([action(saveBody()),action(saveBody())]);assert.ok(results.some(r=>r.status==='fulfilled'));assert.equal(captures,1);detail=(results.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<any>).value;for(const result of results)if(result.status==='fulfilled')assert.equal(result.value.version.id,detail.version.id);
  const retry=await action(saveBody());assert.equal(retry.version.id,detail.version.id);assert.equal(captures,1);assert.equal(retry.versions.length,1);assert.equal(aiCalls,0);
  await assert.rejects(action(saveBody({payload:{analysis:'Different payload.',quarterlyData:[]}})),e=>(e as ResearchError).status===409);assert.equal(captures,1);
 });
 await t.test('owner-scoped retrieval blocks IDOR and version payloads cannot be rewritten even by SQL updates',async()=>{
  await assert.rejects(action({accountAction:'researchGet',id:detail.item.id},other),e=>(e as ResearchError).status===404);
  await assert.rejects(action({accountAction:'researchMeta',id:detail.item.id,expectedRevision:detail.item.revision,notes:'Foreign overwrite'},other),e=>(e as ResearchError).status===404);
  await assert.rejects(db.query("update public.beta_research_versions set payload='{}'::jsonb where id=$1",[detail.version.id]),/BETA_RESEARCH_IMMUTABLE/);
  assert.equal((await action({accountAction:'researchGet',id:detail.item.id})).version.payload.analysis,'Original investment report.');
  const legacy=(await action({accountAction:'researchList'})).items.find((row:any)=>row.kind==='ticker'&&row.subject==='AAPL'),legacyDetail=await action({accountAction:'researchGet',id:legacy.id});
  await assert.rejects(action({accountAction:'researchGet',id:detail.item.id,versionId:legacyDetail.version.id}),e=>(e as ResearchError).status===404);
  await assert.rejects(action({accountAction:'researchSummary',id:detail.item.id,versionId:legacyDetail.version.id}),e=>(e as ResearchError).status===404);
 });
 await t.test('independent save requests allocate atomic versions and metadata detects stale note edits',async()=>{
  const saved=await Promise.all([action(saveBody({requestId:randomUUID()})),action(saveBody({requestId:randomUUID()}))]);assert.deepEqual(saved.map(row=>row.version.version).sort(),[2,3]);detail=await action({accountAction:'researchGet',id:detail.item.id});
  const patched=await action({accountAction:'researchMeta',id:detail.item.id,expectedRevision:detail.item.revision,notes:'Preserve this thesis note.',next_review:'2026-12-01'});
  await assert.rejects(action({accountAction:'researchMeta',id:detail.item.id,expectedRevision:detail.item.revision,notes:'Stale overwrite'}),e=>(e as ResearchError).status===409);
  assert.equal(patched.notes,'Preserve this thesis note.');assert.equal((await action({accountAction:'researchList',query:'Original investment'})).items.length,1);
 });
 await t.test('checks create no AI work, reviews stay bound to the selected version and acknowledgment resets only notification baseline',async()=>{
  detail=await action({accountAction:'researchGet',id:detail.item.id});await action({accountAction:'researchMeta',id:detail.item.id,expectedRevision:detail.item.revision,monitor_enabled:true,email_enabled:true});
  price=110;const review=await action({accountAction:'researchCheck',id:detail.item.id});assert.equal(review.version_id,detail.version.id);assert.equal(aiCalls,0);
  const old=await action({accountAction:'researchGet',id:detail.item.id,versionId:detail.versions.at(-1).id});assert.equal(old.review,null);
  const notices=await db.query('select * from public.beta_research_notifications where review_id=$1',[review.id]);assert.equal(notices.rows.length,1);assert.equal(notices.rows[0].notification_diff.changes[0].before,'100');
  const acknowledged=await action({accountAction:'researchAcknowledge',id:detail.item.id,reviewId:review.id});assert.ok(acknowledged.review.acknowledged_at);assert.equal(acknowledged.item.needs_review,false);assert.equal(acknowledged.review.diff.changes[0].before,'100');
  price=111;await action({accountAction:'researchCheck',id:detail.item.id});assert.equal((await db.query('select count(*) as n from public.beta_research_notifications')).rows[0].n,1);
  price=120;const latest=await action({accountAction:'researchCheck',id:detail.item.id});const notification=(await db.query('select notification_diff from public.beta_research_notifications where review_id=$1',[latest.id])).rows[0];assert.equal(notification.notification_diff.changes[0].before,'110');assert.equal(latest.diff.changes[0].before,'100');
  const explained=await action({accountAction:'researchExplain',id:detail.item.id,reviewId:latest.id});assert.equal(explained.cached,false);const cached=await action({accountAction:'researchExplain',id:detail.item.id,reviewId:latest.id});assert.equal(cached.cached,true);assert.equal(aiCalls,1);
  const summary=await action({accountAction:'researchSummary',id:detail.item.id,versionId:detail.version.id});assert.equal(summary.cached,false);assert.equal((await action({accountAction:'researchSummary',id:detail.item.id,versionId:detail.version.id})).cached,true);assert.equal(aiCalls,2);
 });
 await t.test('monitor claims and mail claims are deduplicated without changing the personal review date',async()=>{
  const jobs=await rpc('beta_research_claim_due',{batch_size:5});assert.equal(jobs.length,1);assert.equal((await rpc('beta_research_claim_due',{batch_size:5})).length,0);
  assert.equal(await rpc('beta_research_complete_monitor',{uid,item_id:detail.item.id,claim_token:jobs[0].claim_token,next_at:null}),true);
  const item=(await db.query('select next_review,next_check_at from public.beta_research_items where id=$1',[detail.item.id])).rows[0];assert.ok(JSON.stringify(item.next_review).includes('2026-12-01'));assert.ok(item.next_check_at);
  const notices=await rpc('beta_research_claim_notifications',{batch_size:5});assert.equal(notices.length,1);assert.equal(notices[0].diff.changes[0].before,'110');assert.equal((await rpc('beta_research_claim_notifications',{batch_size:5})).length,0);
  assert.equal(await rpc('beta_research_finish_notification',{notice_id:notices[0].id,claim_token:notices[0].claim_token,result_status:'sent'}),true);
 });
 await t.test('soft deletion keeps complete history and allows explicit restoration without exposing internals',async()=>{
  const deleted=await action({accountAction:'researchDelete',id:detail.item.id});assert.ok(deleted.deleted_at);assert.ok(!('user_id'in deleted));assert.ok(!('notification_baseline'in deleted));
  assert.equal((await action({accountAction:'researchList'})).items.some((row:any)=>row.id===detail.item.id),false);assert.equal((await action({accountAction:'researchList',includeDeleted:true})).items.some((row:any)=>row.id===detail.item.id),true);
  const archived=await action({accountAction:'researchGet',id:detail.item.id});assert.equal(archived.versions.length,3);
  await action({accountAction:'researchRestore',id:detail.item.id});assert.equal((await action({accountAction:'researchGet',id:detail.item.id})).item.deleted_at,null);
 });
 await t.test('failed capture can retry the same request without leaving an empty or duplicate version',async()=>{
  const body=saveBody({requestId:randomUUID()}),before=(await action({accountAction:'researchGet',id:detail.item.id})).versions.length;captureFailure=true;
  await assert.rejects(action(body),/Capture unavailable/);assert.equal((await action({accountAction:'researchGet',id:detail.item.id})).versions.length,before);
  const saved=await action(body);assert.equal(saved.versions.length,before+1);detail=saved;
 });
 await t.test('review retention preserves90 recent states and pending mail while original versions and legacy reports remain intact',async()=>{
  const current=await action({accountAction:'researchGet',id:detail.item.id});await action({accountAction:'researchMeta',id:detail.item.id,expectedRevision:current.item.revision,email_enabled:false});
  let firstReview:any;
  for(let i=0;i<95;i++){price=400+i;const review=await action({accountAction:'researchCheck',id:detail.item.id});if(i===0){firstReview=review;await db.query("insert into public.beta_research_notifications(user_id,item_id,review_id,notification_diff) values($1,$2,$3,$4)",[uid,detail.item.id,review.id,JSON.stringify(review.diff)]);}}
  assert.equal((await db.query('select count(*) as n from public.beta_research_reviews where version_id=$1',[detail.version.id])).rows[0].n,91);
  assert.equal((await db.query('select count(*) as n from public.beta_research_reviews where id=$1',[firstReview.id])).rows[0].n,1);
  assert.equal((await action({accountAction:'researchGet',id:detail.item.id})).versions.length,4);assert.equal((await db.query('select count(*) as n from public.beta_reports')).rows[0].n,2);
 });
 await t.test('caps include the trash and are checked before data capture; monitor globally stops at300 checks per UTC day',async()=>{
  const capUser=randomUUID(),versionUser=randomUUID();await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now()),($3,$4,now())',[capUser,'cap@example.com',versionUser,'versions@example.com']);
  await db.query("insert into public.beta_research_items(user_id,identity,kind,subject,title,deleted_at) select $1,'ticker:LIMIT'||n,'ticker','LIMIT'||n,'Limit item',now() from generate_series(1,100) n",[capUser]);
  const before=captures;await assert.rejects(action(saveBody({requestId:randomUUID()}),capUser),/BETA_RESEARCH_ITEM_LIMIT/);assert.equal(captures,before);
  const versionItem=(await db.query("insert into public.beta_research_items(user_id,identity,kind,subject,title,latest_version) values($1,'ticker:NEW','ticker','NEW','NEW',500) returning id",[versionUser])).rows[0].id;
  await db.query("insert into public.beta_research_versions(user_id,item_id,version,payload,snapshot) select $1,$2,n,'{}','{}' from generate_series(1,500)n",[versionUser,versionItem]);
  await assert.rejects(action(saveBody({requestId:randomUUID()}),versionUser),/BETA_RESEARCH_VERSION_LIMIT/);assert.equal(captures,before);
  await db.query('update public.beta_research_items set next_check_at=now()-interval \'1 minute\' where id=$1',[detail.item.id]);
  await db.exec("insert into public.beta_rate_buckets(bucket,count,expires_at) values('research-monitor:'||to_char(now() at time zone 'UTC','YYYY-MM-DD'),300,now()+interval '1 day') on conflict(bucket) do update set count=300");
  assert.deepEqual(await rpc('beta_research_claim_due',{batch_size:5}),[]);
 });
 await t.test('anonymous and authenticated roles cannot access tables or RPC, and service cannot mutate versions directly',async()=>{
  for(const role of ['anon','authenticated','service_role']){await db.exec('set role '+role);try{await assert.rejects(db.query("update public.beta_research_versions set summary='Direct write'"),/permission denied/);}finally{await db.exec('reset role');}}
  for(const role of ['anon','authenticated']){await db.exec('set role '+role);try{await assert.rejects(db.query('select * from public.beta_research_items'),/permission denied/);await assert.rejects(db.query('select public.beta_research_list($1)',[uid]),/permission denied/);}finally{await db.exec('reset role');}}
 });
});
