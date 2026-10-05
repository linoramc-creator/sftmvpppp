import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sharedFeed} from '../supabase/functions/analyze-ticker/feed-cache.ts';
test('shared cache freshness, stale refresh and hard age limit',async()=>{
 const runtime=globalThis as any,original=globalThis.fetch,oldDeno=runtime.Deno,oldEdge=runtime.EdgeRuntime;
 let calls=0;let background:Promise<any>|undefined;
 const payload={fetchedAt:new Date().toISOString(),headlines:[{title:'Market news'}]};
 const create=async()=>{calls++;return payload;};
 runtime.Deno={env:{get:(key:string)=>key==='SUPABASE_URL'?'https://test.supabase.co':'test-only'}};
 runtime.EdgeRuntime={waitUntil:(promise:Promise<any>)=>{background=promise;}};
 let expires=Date.now()+300000,at=Date.now();
 globalThis.fetch=async(_input,init)=>init?.method==='POST'?new Response(null,{status:204}):Response.json([{payload:{...payload,fetchedAt:new Date(at).toISOString()},expires_at:new Date(expires).toISOString()}]);
 try{
  await sharedFeed('fresh',create);assert.equal(calls,0);
  expires=Date.now()-1000;await sharedFeed('stale',create);assert.ok(background);await background;assert.equal(calls,1);
  at=Date.now()-16*60000;await sharedFeed('expired',create);assert.equal(calls,2);
 }finally{globalThis.fetch=original;if(oldDeno===undefined)delete runtime.Deno;else runtime.Deno=oldDeno;if(oldEdge===undefined)delete runtime.EdgeRuntime;else runtime.EdgeRuntime=oldEdge;}
});
