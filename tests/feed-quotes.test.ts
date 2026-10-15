import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeFeedQuote,feedSymbols} from '../supabase/functions/analyze-ticker/feed-quotes.ts';
const seconds=(s:string)=>Date.parse(s)/1000;
const periods={pre:{start:seconds('2026-10-14T08:00Z'),end:seconds('2026-10-14T13:30Z')},regular:{start:seconds('2026-10-14T13:30Z'),end:seconds('2026-10-14T20:00Z')},post:{start:seconds('2026-10-14T20:00Z'),end:seconds('2026-10-15T00:00Z')}};
function raw(at:string,price:number,times:string[],closes:number[],minute=false){return {chart:{result:[{meta:{regularMarketTime:seconds(at),regularMarketPrice:price,currency:'USD',currentTradingPeriod:periods,dataGranularity:minute?'1m':'1d'},timestamp:times.map(seconds),indicators:{quote:[{close:closes}]}}]}};}
test('feed premarket uses a completed minute at least 60s old and the previous close',()=>{
 const daily=raw('2026-10-13T20:00Z',100,['2026-10-12T13:30Z','2026-10-13T13:30Z'],[99,100]);
 const intra=raw('2026-10-13T20:00Z',100,['2026-10-14T12:57Z','2026-10-14T12:58Z','2026-10-14T12:59:30Z'],[101,102,999],true);
 const result=normalizeFeedQuote('SPY','SPY',daily,intra,Date.parse('2026-10-14T13:00:30Z'));
 assert.equal(result.session,'pre');assert.equal(result.price,102);assert.equal(result.at,'2026-10-14T12:59:00.000Z');assert.equal(result.delaySeconds,90);assert.equal(result.reference,'previous-close');assert.ok(Math.abs(result.change!-2)<1e-8);
});
test('postmarket compares with the same-day regular close, never the previous day',()=>{
 const daily=raw('2026-10-14T20:00Z',110,['2026-10-13T13:30Z','2026-10-14T13:30Z'],[100,110]);
 const intra=raw('2026-10-14T20:00Z',110,['2026-10-14T20:57Z','2026-10-14T20:58Z','2026-10-14T20:59Z'],[111,112.2,999],true);
 const result=normalizeFeedQuote('SPY','SPY',daily,intra,Date.parse('2026-10-14T21:00Z'));
 assert.equal(result.session,'post');assert.equal(result.price,112.2);assert.equal(result.reference,'regular-close');assert.ok(Math.abs(result.change!-2)<1e-8);
});
test('feed does not relabel stale regular prices as extended trading or fabricate unavailable percentages',()=>{
 const daily=raw('2026-10-13T20:00Z',100,['2026-10-13T13:30Z'],[100]);
 const intra=raw('2026-10-13T20:00Z',100,['2026-10-13T12:58Z'],[102],true);
 const r=normalizeFeedQuote('SPY','SPY',daily,intra,Date.parse('2026-10-14T13:00Z'));
 assert.equal(r.session,'closed');assert.equal(r.at,'2026-10-13T20:00:00.000Z');assert.equal(r.change,null);
 assert.deepEqual(feedSymbols('spy,QQQ,SPY'),['SPY','QQQ']);
 for(const bad of ['AAPL,MSFT,NVDA,MU,SPY,QQQ,TLT','https://private','AAPL,',{}])assert.equal(feedSymbols(bad),null);
});
test('Asian index returns use the exchange date rather than New York midnight',()=>{
 const data=raw('2026-10-14T05:00Z',110,['2026-10-13T00:00Z','2026-10-14T00:00Z'],[100,110]);
 data.chart.result[0].meta.exchangeTimezoneName='Asia/Seoul';data.chart.result[0].meta.currentTradingPeriod={regular:{start:seconds('2026-10-14T00:00Z'),end:seconds('2026-10-14T06:00Z')}};
 const r=normalizeFeedQuote('^KS11','KOSPI',data,null,Date.parse('2026-10-14T06:15Z'));
 assert.equal(r.date,'2026-10-14');assert.equal(r.timezone,'Asia/Seoul');assert.equal(r.session,'regular');assert.ok(Math.abs(r.change!-10)<1e-8);
});
test('overnight futures exclude their unfinished daily candle from the prior-close reference',()=>{
 const data=raw('2026-10-14T05:00Z',102,['2026-10-12T22:00Z','2026-10-13T22:00Z'],[100,102]);
 data.chart.result[0].meta.currentTradingPeriod={regular:{start:seconds('2026-10-13T22:00Z'),end:seconds('2026-10-14T21:00Z')}};
 const r=normalizeFeedQuote('NQ=F','Nasdaq future',data,null,Date.parse('2026-10-14T05:01Z'));
 assert.ok(Math.abs(r.change!-2)<1e-8);assert.equal(r.reference,'previous-close');
});
