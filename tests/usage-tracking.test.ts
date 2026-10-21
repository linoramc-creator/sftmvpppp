import {test} from 'node:test';
import assert from 'node:assert/strict';
import {secureRequest} from '../supabase/functions/analyze-ticker/beta-security.ts';

const id='11111111-1111-4111-8111-111111111111';
function fixture(t:any){
 const previousFetch=globalThis.fetch,previousDeno=(globalThis as any).Deno,statuses:string[]=[];
 (globalThis as any).Deno={env:{get:(key:string)=>key==='SUPABASE_URL'?'https://project.example.test':'test-only'}};
 globalThis.fetch=async(input:any,init:any={})=>{
  const url=String(input);
  if(url.includes('/auth/v1/user'))return Response.json({id,email:'unit@example.test',email_confirmed_at:'2026-01-01'});
  if(url.includes('/rpc/beta_active_user'))return Response.json(true);
  if(url.includes('/rpc/beta_reserve'))return Response.json(id);
  if(url.includes('/beta_usage?')){assert.equal(init.method,'PATCH');statuses.push(JSON.parse(init.body).status);return new Response(null,{status:204});}
  throw Error('Unexpected request');
 };
 t.after(()=>{globalThis.fetch=previousFetch;(globalThis as any).Deno=previousDeno;});
 return statuses;
}
const request=(body:any)=>new Request('https://project.example.test/functions/v1/analyze-ticker',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+'x'.repeat(30)},body:JSON.stringify(body)});
function fragmented(text:string,contentType:string){
 const bytes=new TextEncoder().encode(text);
 return new Response(new ReadableStream<Uint8Array>({start(controller){for(let i=0;i<bytes.length;i+=7)controller.enqueue(bytes.slice(i,i+7));controller.close();}}),{headers:{'Content-Type':contentType}});
}
const event=(value:unknown)=>'data: '+(typeof value==='string'?value:JSON.stringify(value))+'\n\n';
const choice=(reason:string|null=null)=>({choices:[{index:0,delta:{content:reason?'':'Análisis de energía y crédito.'},finish_reason:reason}]});

test('usage records a fragmented SSE report as completed only after stop and DONE',async t=>{
 const statuses=fixture(t),text=event({__quarterly:[{note:'Información estructurada. '.repeat(300)}]})+event(choice())+event(choice('stop'))+event('[DONE]');
 const response=await secureRequest(request({ticker:'AAPL'}),async()=>fragmented(text,'text/event-stream; charset=utf-8'));
 assert.equal(await response.text(),text);assert.deepEqual(statuses,['completed']);
});

test('DONE cannot mark truncated, unfinished, invalid or provider-error SSE reports as completed usage',async t=>{
 const statuses=fixture(t);
 for(const text of [event(choice())+event(choice('length'))+event('[DONE]'),event(choice())+event('[DONE]'),event(choice())+event(choice('stop')),event({__error:'Unavailable'})+event(choice('stop'))+event('[DONE]'),'data: {broken}\n\n'+event(choice('stop'))+event('[DONE]')]){
  const response=await secureRequest(request({ticker:'AAPL'}),async()=>fragmented(text,'text/event-stream'));
  assert.equal(await response.text(),text);assert.equal(statuses.at(-1),'failed');
 }
 assert.deepEqual(statuses,Array(5).fill('failed'));
});

test('successful JSON data closes as completed without any report DONE marker, but broken JSON fails',async t=>{
 const statuses=fixture(t),text=JSON.stringify({name:'Cotización verificada',items:[{price:1.12345}],note:'data: [DONE] is just text'});
 const response=await secureRequest(request({panel:'regularQuote',subject:'AAPL'}),async()=>fragmented(text,'application/json; charset=utf-8'));
 assert.deepEqual(await response.json(),JSON.parse(text));assert.deepEqual(statuses,['completed']);
 const invalid=await secureRequest(request({panel:'regularQuote',subject:'AAPL'}),async()=>fragmented('{"items":[','application/json'));
 assert.equal(await invalid.text(),'{"items":[');assert.deepEqual(statuses,['completed','failed']);
});

test('transport errors fail usage, while user cancellation wins an in-flight EOF race and propagates upstream',async t=>{
 const statuses=fixture(t);let upstreamCancelled=false;
 const stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode(event(choice())));},cancel(reason){upstreamCancelled=reason==='user-cancel';}});
 const response=await secureRequest(request({ticker:'AAPL'}),async()=>new Response(stream,{headers:{'Content-Type':'text/event-stream'}}));
 const reader=response.body!.getReader();await reader.read();await reader.cancel('user-cancel');
 assert.equal(upstreamCancelled,true);assert.deepEqual(statuses,['cancelled']);
 const failed=await secureRequest(request({panel:'regularQuote',subject:'AAPL'}),async()=>new Response(new ReadableStream({start(controller){controller.error(new Error('Disconnected'));}}),{headers:{'Content-Type':'application/json'}}));
 await assert.rejects(failed.text());assert.deepEqual(statuses,['cancelled','failed']);
});
