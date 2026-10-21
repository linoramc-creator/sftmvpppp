import test from 'node:test';
import assert from 'node:assert/strict';
import {marketJson} from '../supabase/functions/analyze-ticker/eodhd-market-fetch.ts';
import {loadAssetRisk} from '../supabase/functions/analyze-ticker/asset-risk.ts';
import {loadAlertQuote,normalizeAlertObservation,isTriggered} from '../supabase/functions/analyze-ticker/asset-alerts.ts';
import {ASIA_MARKETS,collectAsia,normalizeAsiaSession} from '../supabase/functions/daily-brief/asia.ts';

const now=Date.parse('2026-10-21T21:00:00Z'),seconds=(date:string)=>Date.parse(date)/1000;
function history(){
 const timestamp=Array.from({length:30},(_,i)=>Math.floor((now-(30-i)*86400000)/1000));
 return {chart:{result:[{meta:{symbol:'AAPL',instrumentType:'EQUITY',currency:'USD',exchangeTimezoneName:'America/New_York',regularMarketTime:now/1000,regularMarketPrice:105,regularMarketVolume:3000,currentTradingPeriod:{regular:{start:seconds('2026-10-21T13:30Z'),end:seconds('2026-10-21T20:00Z')}}},timestamp,indicators:{quote:[{open:timestamp.map(()=>100),high:timestamp.map(()=>101),low:timestamp.map(()=>99),close:timestamp.map(()=>100),volume:timestamp.map(()=>1000)}],adjclose:[{adjclose:timestamp.map(()=>100)}]}}]}};
}
function source(primary:any,fallback:any,calls:{primary:number;fallback:number}):typeof marketJson{
 return (url,init,options)=>marketJson(url,init,{...options,primary:async()=>{calls.primary++;return primary;},fetcher:async()=>{calls.fallback++;return new Response(JSON.stringify(fallback));}});
}

test('risk prefers usable adjusted EODHD history and falls back coherently on an unusable series',async()=>{
 const calls={primary:0,fallback:0},raw=history(),risk=await loadAssetRisk('AAPL',source(raw,null,calls),now);
 assert.equal(risk.currency,'USD');assert.equal(risk.history.length,30);assert.equal(risk.history.at(-1)?.vol20,0);assert.equal(calls.fallback,0);
 const invalid=history();delete (invalid.chart.result[0].indicators as any).adjclose;
 const fallback=await loadAssetRisk('AAPL',source(invalid,raw,calls),now);
 assert.equal(fallback.history.length,30);assert.deepEqual(calls,{primary:2,fallback:1});
});

test('alerts preserve source price, change and volume and never accept stale or future primary observations',async()=>{
 const calls={primary:0,fallback:0},raw=history(),quote=await loadAlertQuote('AAPL',source(raw,null,calls),now);
 assert.equal(quote.price,105);assert.ok(Math.abs(quote.change!-5)<1e-8);assert.equal(quote.relativeVolume,3);assert.equal(calls.fallback,0);
 for(const at of [now-5*86400000,now+120000]){
  const stale=history();stale.chart.result[0].meta.regularMarketTime=at/1000;
  assert.equal(normalizeAlertObservation(stale,now).price,null);
  assert.equal(isTriggered('price_above',1,normalizeAlertObservation(stale,now)),false);
  assert.equal((await loadAlertQuote('AAPL',source(stale,raw,calls),now)).price,105);
 }
 assert.deepEqual(calls,{primary:3,fallback:2});
});

const cutoff=Date.parse('2026-10-15T05:02Z');
function asiaMinutes(futureOnly=false){return {chart:{result:[{meta:{dataGranularity:'1m',regularMarketTime:seconds('2026-10-15T05:05Z'),regularMarketPrice:999},timestamp:(futureOnly?['2026-10-15T05:02Z']:['2026-10-15T05:00Z','2026-10-15T05:01Z','2026-10-15T05:02Z']).map(seconds),indicators:{quote:[{close:futureOnly?[999]:[101,102,999]}]}}]}};}
function asiaDaily(){return {chart:{result:[{meta:{regularMarketTime:seconds('2026-10-15T06:45Z'),regularMarketPrice:999},timestamp:['2026-10-14T00:00Z','2026-10-15T00:00Z'].map(seconds),indicators:{quote:[{close:[100,999]}]}}]}};}

test('Asia accepts completed one-minute primary observations and excludes both incomplete bars and later closes',async()=>{
 const calls={primary:0,fallback:0},read=source(asiaMinutes(),null,calls),result=await collectAsia(cutoff,async()=>asiaDaily(),read);
 assert.equal(result.markets.length,4);assert.ok(result.markets.every(m=>m.price===102&&m.at==='2026-10-15T05:02:00.000Z'));assert.equal(calls.fallback,0);assert.equal(calls.primary,4);
 const noObservation=normalizeAsiaSession(ASIA_MARKETS[0],asiaDaily(),asiaMinutes(true),cutoff);
 assert.equal(noObservation.price,100);assert.equal(noObservation.status,'previous');
});

test('Asia falls back when EODHD has only bars after the requested cutoff',async()=>{
 const calls={primary:0,fallback:0},result=await collectAsia(cutoff,async()=>asiaDaily(),source(asiaMinutes(true),asiaMinutes(),calls));
 assert.ok(result.markets.every(m=>m.price===102));assert.deepEqual(calls,{primary:4,fallback:4});
});
