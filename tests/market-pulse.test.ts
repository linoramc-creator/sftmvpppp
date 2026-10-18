import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildMarketPulse,pulseVolume,pulseTrend,rotationMetrics} from '../supabase/functions/analyze-ticker/market-pulse.ts';
import type {PriceSeries} from '../supabase/functions/analyze-ticker/market-analytics.ts';
const now=Date.parse('2026-10-16T22:00Z'),open=Date.parse('2026-10-16T13:30Z');
function chart(type='ETF',intraday=false){
 const times=intraday?[open,open+300000,open+600000]:Array.from({length:61},(_,i)=>open-(60-i)*86400000);
 const q={open:times.map((_,i)=>(intraday?158:98)+i),high:times.map((_,i)=>(intraday?161:102)+i),low:times.map((_,i)=>(intraday?157:97)+i),close:times.map((_,i)=>(intraday?159:100)+i),volume:times.map((_,i)=>intraday?(i+1)*100:1000+i)};
 return {chart:{result:[{meta:{symbol:type==='INDEX'?'^GSPC':'SPY',instrumentType:type,currency:'USD',exchangeTimezoneName:'America/New_York',regularMarketTime:Date.parse('2026-10-16T20:00Z')/1000,regularMarketPrice:160,regularMarketVolume:1060,longName:type==='INDEX'?'S&P 500':'SPDR S&P 500 ETF',dataGranularity:intraday?'5m':'1d',currentTradingPeriod:{regular:{start:open/1000,end:Date.parse('2026-10-16T20:00Z')/1000}}},timestamp:times.map(t=>t/1000),indicators:{quote:[q],adjclose:[{adjclose:[...q.close]}]}}]}};
}
test('market pulse keeps index points and never invents tradable volume or VWAP',()=>{
 const result=buildMarketPulse('^GSPC',chart('INDEX'),chart('INDEX',true),undefined,now);
 assert.equal(result.instrument.priceUnit,'pts');assert.equal(result.session.volume,null);assert.equal(result.vwapApprox,null);assert.equal(result.intraday.volume.length,0);assert.ok(result.intraday.candles.every(c=>c.volume===null));assert.equal(result.risk.asOf,'2026-10-16');assert.ok(result.trend.return20!>0);assert.equal(result.quoteAt,'2026-10-16T20:00:00.000Z');
});
test('ETF VWAP is a dated approximation from complete valid volume bars and missing volume disables it',()=>{
 const intraday=chart('ETF',true),result=buildMarketPulse('SPY',chart(),intraday,undefined,now);
 const expected=((161+157+159)/3*100+(162+158+160)/3*200+(163+159+161)/3*300)/600;
 assert.ok(Math.abs(result.vwapApprox!-expected)<1e-10);assert.equal(result.vwapAt,'2026-10-16T13:45:00.000Z');
 intraday.chart.result[0].indicators.quote[0].volume[1]=null as unknown as number;
 assert.equal(buildMarketPulse('SPY',chart(),intraday,undefined,now).vwapApprox,null);
});
test('VWAP does not claim full-session coverage when intraday history starts after the open',()=>{
 const intraday=chart('ETF',true);intraday.chart.result[0].timestamp=intraday.chart.result[0].timestamp.map(t=>t+1800);
 assert.equal(buildMarketPulse('SPY',chart(),intraday,undefined,now).vwapApprox,null);
});
test('current five-minute bars are partial and never enter the completed-bar volume profile',()=>{
 const intraday=chart('ETF',true),at=open+720000;intraday.chart.result[0].meta.regularMarketTime=at/1000;
 const daily=chart();daily.chart.result[0].meta.regularMarketTime=at/1000;
 const result=buildMarketPulse('SPY',daily,intraday,undefined,at);
 assert.equal(result.intraday.candles.at(-1)?.partial,true);assert.equal(result.intraday.volume.length,2);assert.equal(result.vwapAt,'2026-10-16T13:40:00.000Z');assert.equal(result.trend.date,'2026-10-15');
});
test('missing or incorrectly labelled intraday bars remain unavailable rather than being re-labelled five minutes',()=>{
 const intraday=chart('ETF',true);intraday.chart.result[0].meta.dataGranularity='1h';
 const result=buildMarketPulse('SPY',chart(),intraday,undefined,now);assert.equal(result.intraday.candles.length,0);assert.equal(result.vwapApprox,null);assert.equal(result.daily.length,61);
});
test('volume comparison uses actual matching clock bars and at least two prior sessions',()=>{
 const dates=['2026-10-13','2026-10-14','2026-10-15','2026-10-16'],candles=dates.flatMap((day,i)=>[0,1].map(slot=>({time:Date.parse(day+'T13:30Z')+slot*300000,open:100,high:101,low:99,close:100,volume:i===3?300:100,partial:false})));
 const result=pulseVolume(candles,dates[3],'America/New_York');assert.equal(result[1].cumulative,600);assert.equal(result[1].comparison,200);assert.equal(result[1].samples,3);
 assert.equal(pulseVolume(candles.slice(-4),dates[3],'America/New_York')[1].comparison,null);
});
test('trend metrics stop at the verified closed-session date and require enough observations',()=>{
 const daily=chart(),result=pulseTrend(daily.chart.result[0],'2026-10-15');assert.equal(result.date,'2026-10-15');assert.ok(Math.abs(result.return5!-(159/154-1)*100)<1e-10);assert.equal(result.ma20,149.5);
 const short=chart();short.chart.result[0].timestamp=short.chart.result[0].timestamp.slice(-3);short.chart.result[0].indicators.adjclose[0].adjclose=[158,159,160];
 assert.equal(pulseTrend(short.chart.result[0],'2026-10-16').ma20,null);
});
test('sector rotation uses a common date and compares returns, never calls them institutional flows or breadth',()=>{
 const dates=Array.from({length:23},(_,i)=>new Date(open-(22-i)*86400000).toISOString().slice(0,10));
 const series=(symbol:string,scale:number):PriceSeries=>({symbol,currency:'USD',dates,closes:dates.map((_,i)=>100+i*scale),raw:[],volumes:[]});
 const result=rotationMetrics([series('SPY',1),series('XLK',2)]);assert.equal(result.date,'2026-10-16');assert.equal(result.items.length,1);assert.ok(result.items[0].relative20!>0);
 assert.equal(rotationMetrics([series('XLK',2)]).items[0].relative20,null);
});
