import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bondsCreditPanel,SOVEREIGN_MARKETS} from '../supabase/functions/analyze-ticker/bonds-credit.ts';

test('complete EODHD curves and quoted ETF histories prevent redundant legacy Treasury, monthly sovereign and Massive requests',async()=>{
 const fetcher=globalThis.fetch,clock=Date.now,deno=(globalThis as any).Deno;
 const requests:URL[]=[],fixed=Date.parse('2026-10-21T15:00:00Z'),last=Date.parse('2026-10-20T20:00:00Z')/1000;
 Date.now=()=>fixed;
 (globalThis as any).Deno={env:{get:(name:string)=>name==='EODHD_API_KEY'?'local-test-bonds-priority':''}};
 globalThis.fetch=async input=>{
  const url=new URL(String(input));requests.push(url);
  if(url.hostname==='eodhd.com'){
   const path=url.pathname.replace('/api/','');
   if(path==='ust/yield-rates'||path==='ust/real-yield-rates')return Response.json({data:url.searchParams.get('filter[year]')==='2026'?(path.includes('real-')?['5Y','7Y','10Y','20Y','30Y']:['1M','3M','6M','1Y','2Y','3Y','5Y','7Y','10Y','20Y','30Y']).map(tenor=>({date:'2026-10-20',tenor,rate:path.includes('real-')?2:4})):[]});
   if(path==='exchange-symbol-list/GBOND')return Response.json(['US','FR','DE','UK'].flatMap(prefix=>['2Y','5Y','10Y',prefix==='FR'?'1Y':'30Y'].map(tenor=>({Code:prefix+tenor,Country:({US:'USA',FR:'France',DE:'Germany',UK:'UK'} as Record<string,string>)[prefix],Currency:prefix==='US'?'USD':prefix==='UK'?'GBP':'EUR',Exchange:'GBOND',Type:'BOND'}))));
   if(path.endsWith('.GBOND'))return Response.json([{date:'2026-10-19',close:4.1},{date:'2026-10-20',close:4.2}]);
   if(path.startsWith('v1.1/fundamentals/'))return Response.json({General:{Code:path.split('/').at(-1)!.split('.')[0],Type:'ETF',CurrencyCode:'USD',Exchange:'US'}});
   if(path==='exchange-details/US')return Response.json({Timezone:'America/New_York',Currency:'USD',TradingHours:{Open:'09:30:00',Close:'16:00:00',WorkingDays:'Mon,Tue,Wed,Thu,Fri'}});
   if(path.startsWith('real-time/'))return Response.json({code:path.slice('real-time/'.length),timestamp:last,close:101});
   if(path.startsWith('eod/'))return Response.json([{date:'2026-10-19',open:99,high:101,low:98,close:100,adjusted_close:100,volume:1000},{date:'2026-10-20',open:100,high:102,low:99,close:101,adjusted_close:101,volume:1200}]);
   return Response.json({data:[]});
  }
  if(url.hostname==='api.stlouisfed.org')return Response.json({observations:[{date:'2026-10-20',value:'1'}]});
  return new Response('',{status:503});
 };
 try{
  const result=await bondsCreditPanel({FRED_KEY:'local-fallback-test',MASSIVE_API_KEY:'local-massive-test'});
  const fred=requests.filter(u=>u.hostname==='api.stlouisfed.org').map(u=>u.searchParams.get('series_id'));
  for(const id of ['DGS1MO','DGS3MO','DGS6MO','DGS1','DGS2','DGS5','DGS10','DGS20','DGS30','DFII10',...SOVEREIGN_MARKETS.map(m=>m.id)])assert.ok(!fred.includes(id),id+' should be served by the preferred API, without an unused fallback request');
  assert.ok(fred.includes('BAMLC0A0CM'),'uncovered credit indicators retain their existing source');
  assert.ok(fred.includes('T5YIFR'),'an uncovered inflation indicator remains available');
  assert.ok(!requests.some(u=>/massive|polygon|yahoo/.test(u.hostname)),'verified EOD prices and curves must not generate extra requests to legacy market providers');
  assert.equal(result.marketRates?.sovereigns.length,4);
  assert.equal(result.base.series.find(s=>s.id==='DGS20')?.points.at(-1)?.value,4);
  assert.equal(result.proxies.find(p=>p.symbol==='BIZD')?.price,101);
  assert.equal(result.proxies.find(p=>p.symbol==='BIZD')?.date,'2026-10-20');
 }finally{globalThis.fetch=fetcher;Date.now=clock;(globalThis as any).Deno=deno;}
});
