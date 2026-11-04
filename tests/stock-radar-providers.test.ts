import test from 'node:test';import assert from 'node:assert/strict';import {createRadarFmpReader} from '../supabase/functions/analyze-ticker/stock-radar-providers.ts';
import {createStockRadarFallback} from '../supabase/functions/analyze-ticker/stock-radar-fallback.ts';
import {normalizeEodhdQuarterly} from '../supabase/functions/analyze-ticker/eodhd-fundamentals.ts';
test('optional statement fallback only sends fixed endpoint queries and never starts requests for unsafe inputs',async()=>{
 let calls=0;const read=createRadarFmpReader('test-private',async()=>{calls++;return Response.json([]);});
 for(const [path,query]of [['https://evil.test',{symbol:'AAPL'}],['profile',{symbol:'AAPL?apikey=bad'}],['income-statement',{symbol:'AAPL',period:'annual'}],['cash-flow-statement',{symbol:'AAPL',limit:1000}],['profile',{symbol:'AAPL',url:'https://evil.test'}]] as const)assert.equal(await read(path,query),null);
 assert.equal(calls,0);
});
test('fallback coalesces per-symbol statement reads and cools down denied routes across the entire sample',async()=>{
 let calls=0;const read=createRadarFmpReader('private-test',async(input)=>{calls++;const url=new URL(String(input));assert.equal(url.origin,'https://financialmodelingprep.com');assert.equal(url.searchParams.get('apikey'),'private-test');return url.pathname.endsWith('profile')?Response.json([{symbol:'AAPL',currency:'USD'},{symbol:'OTHER'}]):new Response('upstream diagnostics',{status:403});});
 const results=await Promise.all([read('profile',{symbol:'AAPL'}),read('profile',{symbol:'AAPL'})]);assert.equal(calls,1);assert.deepEqual(results[0],[{symbol:'AAPL',currency:'USD'}]);assert.deepEqual(results[1],results[0]);
 assert.equal(await read('cash-flow-statement',{symbol:'AAPL',period:'quarter',limit:8}),null);assert.equal(await read('cash-flow-statement',{symbol:'MSFT',period:'quarter',limit:8}),null);assert.equal(calls,2);
 assert.equal(await read('quote',{symbol:'AAPL'}),null);assert.equal(await read('quote',{symbol:'MSFT'}),null);assert.equal(calls,3);
});

test('real reader and fallback factory preserve a dated quote required to accept verified quarterly statements',async()=>{
 const now=Date.parse('2026-11-03T15:00Z'),calls:string[]=[],periods=['2025-06-30','2025-09-30','2025-12-31','2026-03-31','2026-06-30'];
 const read=createRadarFmpReader('test-only-private',async(input)=>{
  const url=new URL(String(input)),path=url.pathname.split('/').at(-1)!;calls.push(path);assert.equal(url.origin,'https://financialmodelingprep.com');assert.equal(url.searchParams.get('symbol'),'DEMO');
  if(path==='profile')return Response.json([{symbol:'DEMO',companyName:'Synthetic test company',currency:'USD',sector:'Technology',marketCap:5e9,isEtf:false,isFund:false}]);
  if(path==='quote')return Response.json([{symbol:'DEMO',timestamp:Date.parse('2026-11-02T21:00Z')/1000,marketCap:5e9}]);
  assert.ok(['income-statement','cash-flow-statement'].includes(path));assert.equal(url.searchParams.get('period'),'quarter');assert.equal(url.searchParams.get('limit'),'8');
  return Response.json(periods.map((date,i)=>({symbol:'DEMO',date,filingDate:new Date(Date.parse(date)+35*86400000).toISOString().slice(0,10),period:'Q'+(i%4+1),reportedCurrency:'USD',revenue:100e6+i*10e6,netIncome:20e6,operatingCashFlow:35e6,freeCashFlow:25e6,capitalExpenditure:-10e6})));
 },()=>now);
 const fallback=createStockRadarFallback({now,summary:async()=>null,timeseries:async()=>null,fmpRead:read}),raw=await fallback.fundamentals('DEMO');
 assert.ok(raw,'The allowed quote must reach the normalizer; a profile alone has no source timestamp');assert.equal(raw.General.UpdatedAt,'2026-11-02');assert.equal(raw._radarFallback.capturedAt,'2026-11-03T15:00:00.000Z');assert.equal(normalizeEodhdQuarterly(raw,10,now).length,5);assert.deepEqual(calls.sort(),['cash-flow-statement','income-statement','profile','quote']);
 await fallback.fundamentals('DEMO');await read('quote',{symbol:'DEMO'});assert.equal(calls.length,4,'Warm factory and quote reads share the existing bounded cache');
});
