import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptAssetCandlePrimary,createAssetCandleGetter} from '../supabase/functions/analyze-ticker/asset-candles.ts';
import {marketJson} from '../supabase/functions/analyze-ticker/eodhd-market-fetch.ts';

const now=Date.parse('2026-10-21T22:00:00Z');
const url='https://query1.finance.yahoo.com/v8/finance/chart/VRT?range=3mo&interval=60m&includePrePost=false';
function chart(barDate='2026-10-20',quoteAt='2026-10-21T20:27:00Z',sessionDate='2026-10-21'){
 const timestamp=[13,14,15].map(hour=>Date.parse(`${barDate}T${hour}:30:00Z`)/1000);
 return {chart:{result:[{meta:{symbol:'VRT',instrumentType:'EQUITY',currency:'USD',exchangeTimezoneName:'America/New_York',dataGranularity:'60m',regularMarketTime:Date.parse(quoteAt)/1000,regularMarketPrice:212.15,currentTradingPeriod:{regular:{start:Date.parse(sessionDate+'T13:30:00Z')/1000,end:Date.parse(sessionDate+'T20:00:00Z')/1000}}},timestamp,indicators:{quote:[{open:[210,211,212],high:[212,213,214],low:[209,210,211],close:[211,212,213],volume:[1000,1200,1300]}]}}]}};
}
function transport(primary:any,fallback:any){
 const calls={primary:0,fallback:0};
 const get=createAssetCandleGetter((target,init,options)=>marketJson(target,init,{...options,primary:async()=>{calls.primary++;return primary;},fetcher:async(_target,request)=>{calls.fallback++;assert.equal(new Headers(request?.headers).get('User-Agent'),'Mozilla/5.0');if(fallback instanceof Error)throw fallback;return new Response(JSON.stringify(fallback));}}),()=>now);
 return{get,calls};
}
test('missing an entire quoted session falls back once while the primary provider retains priority for fresh bars',async()=>{
 const stale=chart(),fresh=chart('2026-10-21'),attempt=transport(stale,fresh);
 assert.equal(acceptAssetCandlePrimary(url,stale,now),false);
 assert.deepEqual(await attempt.get(url),fresh);assert.deepEqual(attempt.calls,{primary:1,fallback:1});
 const covered=transport(fresh,Error('Must not fetch a secondary provider'));
 assert.deepEqual(await covered.get(url),fresh);assert.deepEqual(covered.calls,{primary:1,fallback:0});
});
test('an authentic prior-session quote is not rejected for being more than 23 hours old',async()=>{
 const previous=chart('2026-10-20','2026-10-20T20:00:00Z'),attempt=transport(previous,Error('No unnecessary fallback'));
 assert.equal(acceptAssetCandlePrimary(url,previous,now),true);
 assert.deepEqual(await attempt.get(url),previous);assert.equal(attempt.calls.fallback,0);
});
test('premarket and the first incomplete hour do not masquerade as a missing completed session',async()=>{
 for(const quote of ['2026-10-21T12:00:00Z','2026-10-21T14:00:00Z']){
  const primary=chart('2026-10-20',quote),attempt=transport(primary,Error('No premarket backfill'));
  assert.deepEqual(await attempt.get(url),primary);assert.equal(attempt.calls.fallback,0);
 }
});
test('an offline, malformed or older secondary feed cannot erase useful dated primary history',async()=>{
 const primary=chart();
 for(const fallback of [Error('Offline'),{},chart('2026-10-19')]){
  const attempt=transport(primary,fallback);assert.deepEqual(await attempt.get(url),primary);assert.equal(attempt.calls.fallback,1);
 }
});
test('daily and weekly histories do not inherit the hourly session freshness rule',async()=>{
 for(const interval of ['1d','1wk']){
  const raw=chart();raw.chart.result[0].meta.dataGranularity=interval;
  const attempt=transport(raw,Error('No daily/weekly fallback'));
  assert.deepEqual(await attempt.get(url.replace('interval=60m','interval='+interval)),raw);assert.equal(attempt.calls.fallback,0);
 }
});
test('index quotes use the same exchange-session check while currencies retain their continuous-session contract',()=>{
 const raw=chart();raw.chart.result[0].meta.instrumentType='INDEX';
 assert.equal(acceptAssetCandlePrimary(url,raw,now),false);
 raw.chart.result[0].meta.instrumentType='CURRENCY';
 assert.equal(acceptAssetCandlePrimary(url,raw,now),true);
});
