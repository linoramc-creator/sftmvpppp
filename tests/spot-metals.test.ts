import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSpotMetalQuotes,spotMetalDailyClose} from '../supabase/functions/analyze-ticker/spot-metal-quotes.ts';
import {spotMetal} from '../supabase/functions/analyze-ticker/spot-metals.ts';
import {feedSessionQuote} from '../supabase/functions/analyze-ticker/feed-quotes.ts';
import {secureRequest} from '../supabase/functions/analyze-ticker/beta-security.ts';
import type {eodhdGet} from '../supabase/functions/analyze-ticker/eodhd-client.ts';

const now=Date.parse('2026-10-26T12:00Z');
const rows=[{date:'2026-10-22',open:3980,high:4020,low:3970,close:4000,volume:12345},{date:'2026-10-23',open:4000,high:4030,low:3990,close:4020,volume:23456}];
const massive={ticker:'C:XAUUSD',results:rows.map(r=>({t:Date.parse(r.date),o:r.open,h:r.high,l:r.low,c:r.close,v:r.volume}))};
test('spot daily closes retain USD per troy ounce, actual dates and source-consistent returns without manufacturing a quote time',()=>{
 const value=spotMetalDailyClose('XAUUSD=X',[...rows,{...rows[1],date:'2026-10-26',close:99999},{...rows[1],date:'2026-10-27',close:99999},{...rows[1],date:'2026-10-24',close:null}],'eodhd',now)!;
 assert.equal(value.price,4020);assert.equal(value.date,'2026-10-23');assert.ok(Math.abs(value.change!-.5)<1e-10);assert.equal(value.currency,'USD');assert.equal(value.unit,'USD/oz t');
 assert.equal(value.displaySymbol,'XAUUSD');assert.equal(value.priceKind,'daily-close');assert.equal(value.session,'closed');assert.equal(value.at,null);assert.equal(value.delaySeconds,null);assert.equal(value.reference,'previous-close');
 assert.equal('volume' in value,false);assert.equal(spotMetal('GC=F'),null);assert.equal(spotMetal('toString'),null);assert.equal(spotMetalDailyClose('GC=F',rows,'eodhd',now),null);
});
test('missing, stale and malformed spot closes remain absent; single observations do not imply a return',()=>{
 for(const raw of [[],[{...rows[0],date:'2026-10-01'}],[{...rows[0],date:'2026-02-30'}],[{...rows[0],close:0}],[{...rows[0],close:-1}],[{...rows[0],close:'4000'}],[{...rows[0],high:3900}]]){
  const value=spotMetalDailyClose('XAGUSD=X',raw,'eodhd',now)!;assert.equal(value.price,null);assert.equal(value.change,null);assert.equal(value.at,null);assert.equal(value.date,null);
 }
 const one=spotMetalDailyClose('XAUUSD=X',[rows[1]],'eodhd',now)!;assert.equal(one.price,4020);assert.equal(one.change,null);assert.equal(one.reference,null);
});
test('Massive metal bars use their own daily closes and reject a different returned pair',()=>{
 const value=spotMetalDailyClose('XAUUSD=X',massive,'massive',now)!;
 assert.equal(value.price,4020);assert.equal(value.date,'2026-10-23');assert.equal(value.at,null);assert.ok(Math.abs(value.change!-.5)<1e-10);
 assert.equal(spotMetalDailyClose('XAGUSD=X',massive,'massive',now)?.price,null);
});
test('primary spot reads are coalesced and cached for an hour instead of buying the same daily history each feed refresh',async()=>{
 let at=now,reads=0,secondary=0;const calls:any[]=[];
 const request=(async(path:string,query:any,options:any)=>{reads++;calls.push({path,query,options});return rows;}) as typeof eodhdGet;
 const read=createSpotMetalQuotes({request,now:()=>at,massiveKey:()=>{secondary++;return 'test-secret';}});
 const [first,otherLabel]=await Promise.all([read('XAUUSD=X'),read('XAUUSD=X','Oro personal')]);
 assert.equal(reads,1);assert.equal(secondary,0);assert.equal(first?.label,'Oro · Spot');assert.equal(otherLabel?.label,'Oro personal');
 assert.equal(calls[0].path,'eod/XAUUSD.FOREX');assert.ok(calls[0].options.ttlMs>=3600000);assert.equal(calls[0].query.to,'2026-10-25');
 at+=60000;assert.equal((await read('XAUUSD=X'))?.price,4020);assert.equal(reads,1);
 at+=3600000;await read('XAUUSD=X');assert.equal(reads,2);
 await read('GC=F');assert.equal(reads,2);
});
test('unavailable primary spot can use entitled Massive completed-day bars without requesting current quotes or exposing a key in the URL',async()=>{
 const request=(async()=>[]) as typeof eodhdGet,calls:any[]=[];
 const read=createSpotMetalQuotes({request,now:()=>now,massiveKey:()=> 'stored-secret',fetcher:async(input,init)=>{calls.push({url:String(input),init});return Response.json(massive);}});
 const result=await read('XAUUSD=X');assert.equal(result?.price,4020);assert.equal(result?.at,null);assert.equal(calls.length,1);
 assert.ok(calls[0].url.includes('/C:XAUUSD/range/1/day/2026-10-12/2026-10-25'));assert.ok(!calls[0].url.includes('stored-secret'));assert.equal(calls[0].init.headers.Authorization,'Bearer stored-secret');
 await read('XAUUSD=X');assert.equal(calls.length,1);
});
test('provider denial stays unavailable and retries only after the short negative cache expires',async()=>{
 let at=now,reads=0,secondary=0;
 const request=(async()=>{reads++;return null;}) as typeof eodhdGet;
 const read=createSpotMetalQuotes({request,now:()=>at,massiveKey:()=> 'stored-secret',fetcher:async()=>{secondary++;return new Response(null,{status:403});}});
 for(let i=0;i<2;i++){const result=await read('XAGUSD=X');assert.equal(result?.price,null);assert.equal(result?.date,null);assert.equal(result?.at,null);}
 assert.equal(reads,1);assert.equal(secondary,1);at+=120001;await read('XAGUSD=X');assert.equal(reads,2);assert.equal(secondary,2);
});
test('authenticated spot validation and feed quotes use the actual spot series, never a gold future or an invented real-time timestamp',async t=>{
 const previousFetch=globalThis.fetch,previousDeno=(globalThis as any).Deno,previousNow=Date.now,paths:string[]=[],uid='22222222-2222-4222-8222-222222222222';
 Date.now=()=>now;(globalThis as any).Deno={env:{get:(key:string)=>({SUPABASE_URL:'https://project.supabase.co',SUPABASE_ANON_KEY:'test-public',SUPABASE_SERVICE_ROLE_KEY:'test-service',EODHD_API_KEY:'test-spot-endpoint'} as Record<string,string>)[key]}};
 globalThis.fetch=async(input,init)=>{
  const url=new URL(String(input));paths.push(url.hostname+url.pathname);
  if(url.pathname==='/auth/v1/user')return Response.json({id:uid,email:'test@example.com',email_confirmed_at:'2026-10-01'});
  if(url.pathname.endsWith('/rpc/beta_active_user'))return Response.json(true);
  if(url.pathname.endsWith('/rpc/beta_reserve'))return Response.json('44444444-4444-4444-8444-444444444444');
  if(url.pathname.endsWith('/beta_usage'))return new Response(null,{status:204});
  if(url.hostname==='eodhd.com'&&url.pathname==='/api/eod/XAUUSD.FOREX')return Response.json(rows);
  throw Error('Unexpected request '+url.pathname);
 };
 t.after(()=>{globalThis.fetch=previousFetch;(globalThis as any).Deno=previousDeno;Date.now=previousNow;});
 const req=new Request('https://project.supabase.co/functions/v1/analyze-ticker',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+'x'.repeat(30)},body:JSON.stringify({accountAction:'validateFeedAsset',group:'commodities',symbol:'XAU/USD'})});
 const response=await secureRequest(req,async()=>{throw Error('Unexpected dispatch');});assert.equal(response.status,200);assert.deepEqual(await response.json(),{symbol:'XAUUSD=X',label:'Oro · Spot'});
 const quote=await feedSessionQuote('XAUUSD=X','Oro · Spot',true);assert.equal(quote.price,4020);assert.equal(quote.priceKind,'daily-close');assert.equal(quote.date,'2026-10-23');assert.equal(quote.at,null);
 assert.equal(paths.filter(path=>path.includes('eod/XAUUSD.FOREX')).length,1);assert.ok(paths.every(path=>!path.includes('GC')&&!path.includes('real-time')&&!path.includes('intraday')&&!path.includes('yahoo')));
});
