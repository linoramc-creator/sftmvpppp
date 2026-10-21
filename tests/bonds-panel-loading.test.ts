import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bondsPanel,cached} from '../supabase/functions/analyze-ticker/panels.ts';

test('Treasury and ETF requests start together and every macro series requests the full available ten-year window',async()=>{
 const original=globalThis.fetch,fredUrls:URL[]=[],etfs:string[]=[];
 let release:()=>void=()=>{};const fredGate=new Promise<void>(resolve=>{release=resolve;});
 globalThis.fetch=async input=>{
  const url=new URL(String(input));
  if(url.hostname==='api.stlouisfed.org'){fredUrls.push(url);await fredGate;return Response.json({observations:[{date:'2020-01-02',value:'1.5'}]});}
  etfs.push(url.pathname);return new Response('',{status:503});
 };
 try{
  const request=bondsPanel({FRED_KEY:'test-only',FMP_KEY:'',TAVILY_KEY:'',FINNHUB_KEY:''});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(fredUrls.length,14);assert.equal(etfs.length,8,'ETF requests must not wait for Treasury to finish');
  const starts=new Set(fredUrls.map(url=>url.searchParams.get('observation_start')));assert.equal(starts.size,1);
  assert.ok(Date.parse([...starts][0]!)<Date.now()-3650*86400000);
  release();const result=await request;
  assert.ok(result.series.every(s=>s.points[0]?.date==='2020-01-02'));assert.equal(result.etfs.length,8);
 }finally{release();globalThis.fetch=original;}
});

test('empty bonds-credit series retry after two minutes while successful and unrelated caches keep their normal TTL',async()=>{
 const original=Date.now;let clock=original(),calls=0,unrelatedCalls=0;Date.now=()=>clock;
 try{
  const load=async()=>{calls++;return {points:calls===1?[]:[{date:'2026-10-20',value:3}]};};
  const unrelated=async()=>{unrelatedCalls++;return {points:[]};};
  await cached('bonds-credit-series:retry-test',3600000,load);await cached('other-series:retry-test',3600000,unrelated);
  clock+=119999;await cached('bonds-credit-series:retry-test',3600000,load);assert.equal(calls,1);
  clock+=1;const recovered=await cached('bonds-credit-series:retry-test',3600000,load);assert.equal(calls,2);assert.equal(recovered.points.length,1);
  clock+=180000;await cached('bonds-credit-series:retry-test',3600000,load);await cached('other-series:retry-test',3600000,unrelated);
  assert.equal(calls,2);assert.equal(unrelatedCalls,1);
 }finally{Date.now=original;}
});
