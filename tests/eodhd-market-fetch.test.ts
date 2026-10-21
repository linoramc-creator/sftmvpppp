import test from 'node:test';
import assert from 'node:assert/strict';
import {marketJson} from '../supabase/functions/analyze-ticker/eodhd-market-fetch.ts';
import {normalizeRegularQuote} from '../supabase/functions/analyze-ticker/regular-quote.ts';
import {normalizeFeedQuote} from '../supabase/functions/analyze-ticker/feed-quotes.ts';
import {normalizeRelativeHistory} from '../supabase/functions/analyze-ticker/relative-comparison.ts';

const url='https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=1mo&interval=1d';
const fixture=()=>({chart:{result:[{meta:{symbol:'AAPL',_provider:'eodhd',instrumentType:'EQUITY',currency:'USD',exchangeTimezoneName:'America/New_York',regularMarketTime:Date.parse('2026-10-21T16:00:00Z')/1000,regularMarketPrice:105,currentTradingPeriod:{regular:{start:Date.parse('2026-10-21T13:30:00Z')/1000,end:Date.parse('2026-10-21T20:00:00Z')/1000}}},timestamp:['2026-10-19T16:00:00Z','2026-10-20T16:00:00Z'].map(v=>Date.parse(v)/1000),indicators:{quote:[{open:[99,100],high:[101,103],low:[98,99],close:[100,102],volume:[1000,1200]}],adjclose:[{adjclose:[100,102]}]}}]}});

test('a valid EODHD chart powers existing feed, report and comparison contracts without a duplicate provider request',async()=>{
 let primary=0,fallback=0;const raw=await marketJson(url,{}, {primary:async()=>{primary++;return fixture();},fetcher:async()=>{fallback++;throw Error('Should not fetch Yahoo');}});
 const now=Date.parse('2026-10-21T16:00:30Z'),regular=normalizeRegularQuote('AAPL',raw,now),feed=normalizeFeedQuote('AAPL','Apple',raw,null,now),relative=normalizeRelativeHistory('AAPL',raw,now);
 assert.equal(primary,1);assert.equal(fallback,0);assert.equal(regular.price,105);assert.equal(regular.currency,'USD');assert.equal(regular.kind,'regular');assert.equal(feed.price,105);assert.equal(feed.reference,'previous-close');assert.deepEqual(relative?.closes,[100,102]);assert.deepEqual(relative?.dates,['2026-10-19','2026-10-20']);
});

test('malformed, unavailable and consumer-unsuitable primary data fall back once to the existing source',async()=>{
 for(const primary of [async()=>null,async()=>({chart:{result:[]}}),async()=>{throw Error('Provider unavailable');}]){let calls=0;const raw=await marketJson(url,{}, {primary,fetcher:async()=>{calls++;return new Response(JSON.stringify(fixture()));}});assert.equal(calls,1);assert.equal(raw.chart.result[0].meta.symbol,'AAPL');}
 let calls=0;await marketJson(url,{}, {primary:async()=>fixture(),acceptPrimary:()=>false,fetcher:async()=>{calls++;return new Response('{}');}});assert.equal(calls,1);
});

test('non-chart providers and POST requests preserve their destination, headers and body without interception',async()=>{
 for(const [target,init] of [['https://api.massive.com/v1/example',{headers:{Authorization:'Bearer test-key'}}],['https://api.tavily.com/search',{method:'POST',body:'{"query":"test"}'}],[url,{method:'POST'}],['https://query1.finance.yahoo.com.evil.test/v8/finance/chart/AAPL',{}]] as [string,RequestInit][]){
  let primary=0,fallback=0;await marketJson(target,init,{primary:async()=>{primary++;return fixture();},fetcher:async(actual,options)=>{fallback++;assert.equal(actual,target);assert.deepEqual(options,init);return new Response('{}');}});assert.equal(primary,0);assert.equal(fallback,1);
 }
});

test('fallback timeout begins after the primary response and a failed fallback produces a stable null',async()=>{
 const raw=await marketJson(url,{}, {timeoutMs:5,primary:async()=>{await new Promise(resolve=>setTimeout(resolve,12));return null;},fetcher:async(_url,init)=>{assert.equal(init?.signal?.aborted,false);return new Response('{}');}});assert.deepEqual(raw,{});
 assert.equal(await marketJson(url,{}, {primary:async()=>null,fetcher:async()=>{throw Error('Offline');}}),null);
});
