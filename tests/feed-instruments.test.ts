import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TREASURY_MATURITIES,treasuryLabel,treasuryIdentifier,commonTreasuryDate} from '../supabase/functions/analyze-ticker/treasury-curve.ts';
import {instrumentInfo,sessionStats} from '../supabase/functions/analyze-ticker/asset-instrument.ts';
import {chartRiskData} from '../supabase/functions/analyze-ticker/asset-risk.ts';
import {hourlyToFourHours} from '../supabase/functions/analyze-ticker/asset-snapshot.ts';
import {regularSessionEnd} from '../supabase/functions/analyze-ticker/market-session.ts';

test('Treasury curve includes the published 3-month, 6-month and 1-year series and preserves dates',()=>{
 assert.deepEqual(TREASURY_MATURITIES.map(p=>p.series),['DGS3MO','DGS6MO','DGS1','DGS2','DGS5','DGS10','DGS20']);
 assert.equal(treasuryLabel(.25),'3 meses');assert.equal(treasuryIdentifier(.25),'DGS3MO');assert.equal(treasuryLabel(.5),'6 meses');assert.equal(treasuryLabel(1),'1 año');
 const points=TREASURY_MATURITIES.map(p=>({years:p.years,yield:4,date:'2026-10-16',changeBp:2}));
 assert.equal(commonTreasuryDate(points),'2026-10-16');
 assert.equal(commonTreasuryDate(points.map((p,i)=>i===0?{...p,date:'2026-10-15'}:p)),null);
 assert.equal(commonTreasuryDate(points.map((p,i)=>i===0?{...p,yield:null}:p)),null);
 assert.equal(commonTreasuryDate([]),null);
});

const times=Array.from({length:22},(_,i)=>Date.parse('2026-09-01T13:30Z')+i*86400000);
const bars=times.map((time,i)=>({time,open:100+i,high:102+i,low:99+i,close:101+i,volume:1000}));
test('index session metrics do not present underlying-market volume as index contracts',()=>{
 const meta={instrumentType:'INDEX',currency:'USD',exchangeTimezoneName:'America/New_York',regularMarketTime:times.at(-1)!/1000,regularMarketVolume:999999};
 const info=instrumentInfo(meta,'^GSPC'),stats=sessionStats(meta,bars,info,Date.parse('2026-10-01T20:00Z'));
 assert.equal(info.priceUnit,'pts');assert.equal(info.volumeUnit,'unavailable');assert.equal(stats.volume,null);assert.equal(stats.volumeRatio,null);assert.equal(stats.averageVolume20,null);assert.equal(stats.previousClose,121);assert.ok(stats.vol20!>0);
});
test('ETF session activity has fund units and a true prior-20-session baseline',()=>{
 const meta={instrumentType:'ETF',currency:'USD',exchangeTimezoneName:'America/New_York',regularMarketTime:times.at(-1)!/1000,regularMarketVolume:2000};
 const info=instrumentInfo(meta,'QQQ'),stats=sessionStats(meta,bars,info,Date.parse('2026-10-01T20:00Z'));
 assert.equal(info.volumeUnit,'fund-units');assert.equal(stats.volume,2000);assert.equal(stats.averageVolume20,1000);assert.equal(stats.volumeRatio,2);assert.ok(stats.atr14!>0);
 const missing=sessionStats({...meta,regularMarketVolume:undefined},bars.map((p,i)=>i===0?{...p,volume:null}:p),info,Date.parse('2026-10-01T20:00Z'));
 assert.equal(missing.volumeRatio,1);
 const incomplete=sessionStats(meta,bars.slice(-20),info,Date.parse('2026-10-01T20:00Z'));assert.equal(incomplete.volumeRatio,null);
});
test('unknown and continuous futures volumes are never relabelled as confirmed contract totals',()=>{
 const info=instrumentInfo({instrumentType:'FUTURE',currency:'USD'},'NQ=F');
 assert.equal(info.kind,'future');assert.equal(info.priceUnit,'pts');assert.equal(info.volumeUnit,'published');
 assert.equal(instrumentInfo({instrumentType:'ETF',currency:'USD'},'TLT').volumeUnit,'fund-units');
});
test('session metrics use the exchange date and mark current incomplete sessions',()=>{
 const meta={instrumentType:'INDEX',exchangeTimezoneName:'Asia/Seoul',regularMarketTime:Date.parse('2026-10-16T01:00Z')/1000,currentTradingPeriod:{regular:{end:Date.parse('2026-10-16T06:30Z')/1000}}};
 const stats=sessionStats(meta,[],instrumentInfo(meta,'^KS11'),Date.parse('2026-10-16T02:00Z'));
 assert.equal(stats.date,'2026-10-16');assert.equal(stats.partial,true);assert.equal(stats.volume,null);assert.equal(stats.vol20,null);
});
test('global index risk supports native index closes without inventing adjusted equity data',()=>{
 const chart={meta:{instrumentType:'INDEX',exchangeTimezoneName:'Asia/Seoul',currency:'KRW'},timestamp:times.map(t=>t/1000),indicators:{quote:[{open:bars.map(b=>b.open),high:bars.map(b=>b.high),low:bars.map(b=>b.low),close:bars.map(b=>b.close),volume:bars.map(b=>b.volume)}]}};
 const result=chartRiskData(chart,'^KS11',Date.parse('2026-10-01T20:00Z'));assert.equal(result.history.length,22);assert.equal(result.currency,'pts');assert.equal(result.history.at(-1)?.volumeRatio,null);assert.ok(result.history.at(-1)?.vol20!>0);
 assert.equal(chartRiskData({...chart,meta:{...chart.meta,instrumentType:'EQUITY'}},'TEST',Date.parse('2026-10-01T20:00Z')).history.length,0);
});
test('overnight future four-hour bars keep the session anchor through midnight',()=>{
 const times=['2026-10-14T03:00Z','2026-10-14T04:00Z','2026-10-14T05:00Z','2026-10-14T06:00Z','2026-10-15T03:00Z'];
 const chart={meta:{instrumentType:'FUTURE',exchangeTimezoneName:'America/Chicago',currentTradingPeriod:{regular:{start:Date.parse('2026-10-13T23:00Z')/1000}}},timestamp:times.map(t=>Date.parse(t)/1000),indicators:{quote:[{open:[10,11,12,13,20],high:[12,13,14,15,22],low:[9,10,11,12,19],close:[11,12,13,14,21],volume:[1,2,3,4,5]}]}};
 const result=hourlyToFourHours(chart);assert.equal(result.length,2);assert.equal(result[0].volume,10);assert.equal(result[0].close,14);assert.equal(result[1].volume,5);
});
test('KOSPI keeps 15:00–15:30 KST partial and out of completed-session risk',()=>{
 const start=Date.parse('2026-10-16T00:00Z')/1000,actualEnd=Date.parse('2026-10-16T06:30Z');
 const meta={symbol:'^KS11',instrumentType:'INDEX',exchangeTimezoneName:'Asia/Seoul',regularMarketTime:Date.parse('2026-10-16T05:59Z')/1000,currentTradingPeriod:{regular:{start,end:start+6*3600}}};
 assert.equal(regularSessionEnd(meta,'^KS11'),actualEnd/1000);
 assert.equal(regularSessionEnd(meta,'OTHER'),start+6*3600);
 const daily=[{time:Date.parse('2026-10-15T00:00Z'),open:100,high:102,low:99,close:101,volume:10},{time:start*1000,open:101,high:104,low:100,close:103,volume:20}];
 const chart={meta,timestamp:daily.map(b=>b.time/1000),indicators:{quote:[{open:daily.map(b=>b.open),high:daily.map(b=>b.high),low:daily.map(b=>b.low),close:daily.map(b=>b.close),volume:daily.map(b=>b.volume)}]}};
 for(const time of ['2026-10-16T06:00Z','2026-10-16T06:15Z','2026-10-16T06:29:59Z']){
  const now=Date.parse(time),stats=sessionStats(meta,daily,instrumentInfo(meta,'^KS11'),now,'^KS11');
  assert.equal(stats.partial,true,time);assert.equal(stats.riskDate,'2026-10-15',time);
  assert.equal(chartRiskData(chart,'^KS11',now).asOf,'2026-10-15',time);
 }
 assert.equal(sessionStats(meta,daily,instrumentInfo(meta,'^KS11'),actualEnd,'^KS11').partial,false);
 assert.equal(chartRiskData(chart,'^KS11',actualEnd).asOf,'2026-10-16');
});
