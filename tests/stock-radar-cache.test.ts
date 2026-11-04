import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {sharedStockRadar} from '../supabase/functions/analyze-ticker/stock-radar-cache.ts';import {classify} from '../supabase/functions/analyze-ticker/beta-security.ts';
const data=()=>({fetchedAt:new Date().toISOString(),asOf:new Date().toISOString(),horizonMonths:6,status:'ready',candidates:[{symbol:'TEST'}]});
test('radar accepts only the fixed authenticated data operation; no provider-controlled query or refresh bypass',()=>{
 assert.equal(classify({panel:'stockResearchRadar',subject:''}).request_class,'data');
 for(const body of [{panel:'stockResearchRadar',subject:'AAPL'},{panel:'stockResearchRadar',force:true},{panel:'stockResearchRadar',query:'a'.repeat(1000)},{panel:'stockResearchRadar',ticker:'AAPL'},{panel:'stockResearchRadar',symbols:['AAPL']}])assert.throws(()=>classify(body));
});
test('a ready shared snapshot, another builder or failure cooldown never starts paid work',async()=>{
 let calls=0;const create=async()=>{calls++;return data();},payload=data();
 assert.deepEqual(await sharedStockRadar(create,{rpc:async()=>({state:'ready',payload})}),{status:200,data:payload});
 assert.deepEqual(await sharedStockRadar(create,{rpc:async()=>({state:'building',payload:null})}),{status:202,data:{status:'building',retryAfterSeconds:8}});
 assert.equal((await sharedStockRadar(create,{rpc:async()=>({state:'cooling',payload:null})})).status,503);
 assert.equal((await sharedStockRadar(create,{rpc:async()=>{throw Error('private key details');}})).status,503);assert.equal(calls,0);
});
test('the lease is acquired before providers and completed with the exact payload; failed work releases into cooldown',async()=>{
 const calls:string[]=[],payload=data();const rpc=async(op:string,token?:string,output?:unknown)=>{calls.push(op);if(op==='claim')return {state:'claimed',token:'lease',payload:null};assert.equal(token,'lease');if(op==='finish')assert.deepEqual(output,payload);return {};};
 const result=await sharedStockRadar(async()=>{calls.push('paid');return payload;},{rpc});assert.deepEqual(calls,['claim','paid','finish']);assert.equal(result.status,200);
 calls.length=0;const failed=await sharedStockRadar(async()=>{calls.push('paid');throw Error('secret provider text');},{rpc});assert.deepEqual(calls,['claim','paid','fail']);assert.equal(failed.status,503);assert.ok(!JSON.stringify(failed).includes('secret'));
});
test('background refresh retains dated data and never serves it beyond the hard age',async()=>{
 const now=Date.now(),prior={...data(),fetchedAt:new Date(now-7*3600000).toISOString()},fresh=data();let background:Promise<unknown>|undefined,calls=0;
 const result=await sharedStockRadar(async()=>{calls++;return fresh;},{now:()=>now,rpc:async op=>op==='claim'?{state:'claimed',token:'background',payload:prior}:{},waitUntil:p=>{background=p;}});
 assert.equal(result.status,200);if(result.status===200){assert.equal(result.data.fetchedAt,prior.fetchedAt);assert.equal(result.data.refreshing,true);}assert.ok(background);await background;assert.equal(calls,1);
 const expired=await sharedStockRadar(async()=>{calls++;return fresh;},{now:()=>now,rpc:async()=>({state:'building',payload:{...prior,fetchedAt:new Date(now-25*3600000).toISOString()}})});assert.equal(expired.status,202);assert.equal(calls,1);
});
test('a legitimate empty scan is returned without replacing the last useful snapshot',async()=>{
 const operations:string[]=[],empty={...data(),status:'unavailable',candidates:[]};const result=await sharedStockRadar(async()=>empty,{rpc:async op=>{operations.push(op);return op==='claim'?{state:'claimed',token:'empty',payload:null}:{};}});assert.deepEqual(operations,['claim','fail']);assert.deepEqual(result,{status:200,data:empty});
});
test('a cold Edge request starts one durable background job and returns promptly for bounded UI polling',async()=>{
 let resolve!:(value:ReturnType<typeof data>)=>void,background:Promise<unknown>|undefined;const operations:string[]=[];
 const result=await sharedStockRadar(()=>new Promise(r=>{resolve=r;}),{rpc:async op=>{operations.push(op);return op==='claim'?{state:'claimed',token:'cold-background',payload:null}:{};},waitUntil:task=>{background=task;}});
 assert.equal(result.status,202);assert.deepEqual(operations,['claim']);assert.ok(background);resolve(data());await background;assert.deepEqual(operations,['claim','finish']);
});
const pg=await import(pathToFileURL(process.env.RESEARCH_PGLITE_MODULE??resolve('../../tools/research-pg/node_modules/@electric-sql/pglite/dist/index.js')).href).catch(()=>null);
test('isolated PostgreSQL cache enforces service-only leases, six-hour freshness, cooldown and immutable token ownership',{skip:pg?false:'PGlite not installed'},async t=>{
 const db=new pg.PGlite();t.after(()=>db.close());await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');await db.exec(await readFile(new URL('../supabase/migrations/202611030001_stock_radar_cache.sql',import.meta.url),'utf8'));
 const rpc=async(op:string,token:string|null=null,output:unknown=null)=>(await db.query('select public.beta_stock_radar_job($1,$2::uuid,$3::jsonb) result',[op,token,output?JSON.stringify(output):null])).rows[0].result as any;
 const claim=await rpc('claim');assert.equal(claim.state,'claimed');assert.equal((await rpc('claim')).state,'building');await assert.rejects(rpc('finish','11111111-1111-4111-8111-111111111111',data()),/RADAR_CONFLICT/);
 await rpc('finish',claim.token,data());const ready=await rpc('claim');assert.equal(ready.state,'ready');assert.equal(ready.payload.candidates[0].symbol,'TEST');
 await db.exec("update public.beta_stock_radar_cache set expires_at=now()-interval '1 minute'");const next=await rpc('claim');assert.equal(next.state,'claimed');assert.ok(next.payload);await rpc('fail',next.token);assert.equal((await rpc('claim')).state,'cooling');
 await db.exec("update public.beta_stock_radar_cache set retry_at=now()-interval '1 minute',payload=jsonb_set(payload,'{fetchedAt}',to_jsonb((now()-interval '25 hours')::text))");const stale=await rpc('claim');assert.equal(stale.payload,null);
 await assert.rejects(rpc('finish',stale.token,{...data(),fetchedAt:new Date(Date.now()+3600000).toISOString()}),/RADAR_INVALID/);
 for(const role of ['anon','authenticated','service_role']){await db.exec('set role '+role);await assert.rejects(db.query('select * from public.beta_stock_radar_cache'),/permission denied/);if(role!=='service_role')await assert.rejects(rpc('claim'),/permission denied/);await db.exec('reset role');}
 const permissions=(await db.query("select relrowsecurity rls from pg_class where relname='beta_stock_radar_cache'")).rows[0];assert.equal(permissions.rls,true);
});
