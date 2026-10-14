import test from 'node:test';
import assert from 'node:assert/strict';
import {tavilyJson,tavilyLimited} from '../supabase/functions/analyze-ticker/tavily-client.ts';
test('an exhausted search plan trips a circuit instead of repeated retries',async()=>{
 const original=globalThis.fetch,clock=Date.now;let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response('',{status:432});};
 try{assert.equal(await tavilyJson({query:'news'},'test'),null);assert.equal(tavilyLimited(),true);assert.equal(await tavilyJson({query:'other'},'test'),null);assert.equal(calls,1);Date.now=()=>clock()+31*60000;assert.equal(tavilyLimited(),false);}
 finally{globalThis.fetch=original;Date.now=clock;}
});
