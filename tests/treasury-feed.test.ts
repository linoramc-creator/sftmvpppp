import {test} from 'node:test';
import assert from 'node:assert/strict';
import {treasury} from '../supabase/functions/analyze-ticker/feed-extras.ts';

test('three-month Treasury fallback uses DGS3MO, retains its actual observation date and calculates basis points',async t=>{
 const originalFetch=globalThis.fetch,originalDeno=(globalThis as any).Deno,originalNow=Date.now,requests:string[]=[];
 Date.now=()=>Date.parse('2026-10-22T07:00Z');
 (globalThis as any).Deno={env:{get:()=>undefined}};
 globalThis.fetch=async input=>{
  const url=new URL(String(input));assert.equal(url.hostname,'api.stlouisfed.org');
  const id=url.searchParams.get('series_id')!;requests.push(id);
  return Response.json({observations:id==='DGS3MO'?[{date:'2026-10-21',value:'.'},{date:'2026-10-20',value:'4.25'},{date:'2026-10-19',value:'4.20'}]:[{date:'2026-10-21',value:'4.10'}]});
 };
 t.after(()=>{globalThis.fetch=originalFetch;(globalThis as any).Deno=originalDeno;Date.now=originalNow;});
 const result=await treasury('test-fred');
 assert.equal(result.length,7);assert.equal(result[0].years,.25);assert.equal(result[0].yield,4.25);assert.equal(result[0].date,'2026-10-20');assert.ok(Math.abs(result[0].changeBp!-5)<1e-10);
 assert.ok(requests.includes('DGS3MO'));assert.ok(!requests.includes('DTB3'));assert.ok(result.slice(1).every(point=>point.date==='2026-10-21'&&point.changeBp===null));
});

test('an unavailable three-month yield remains absent instead of reusing another tenor or fabricating zero',async t=>{
 const originalFetch=globalThis.fetch,originalDeno=(globalThis as any).Deno,originalNow=Date.now;
 Date.now=()=>Date.parse('2026-10-22T09:00Z');
 (globalThis as any).Deno={env:{get:()=>undefined}};
 globalThis.fetch=async input=>Response.json({observations:new URL(String(input)).searchParams.get('series_id')==='DGS3MO'?[{date:'2026-10-21',value:'.'}]:[{date:'2026-10-21',value:'4.10'}]});
 t.after(()=>{globalThis.fetch=originalFetch;(globalThis as any).Deno=originalDeno;Date.now=originalNow;});
 const result=await treasury('test-fred');
 assert.deepEqual(result[0],{years:.25,yield:null,date:null,changeBp:null});assert.ok(result.slice(1).every(point=>point.yield===4.1));
});
