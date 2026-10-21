import test from 'node:test';import assert from 'node:assert/strict';
import{buildAssetCandles,fetchAssetCandles}from'../supabase/functions/analyze-ticker/asset-candles.ts';
import{chartCandles,hourlyToFourHours}from'../supabase/functions/analyze-ticker/asset-candle-series.ts';
const now=Date.parse('2026-10-21T22:00Z');
function chart(interval='60m',kind='EQUITY'){
 const times:number[]=[];for(let d=99;d>=0;d--){const date=new Date(now-d*86400000);if([0,6].includes(date.getUTCDay()))continue;const start=Date.parse(date.toISOString().slice(0,10)+'T13:30Z');for(let h=0;h<(interval==='60m'?7:1);h++)times.push(start+h*3600000);}
 return{chart:{result:[{meta:{symbol:'TEST',longName:'Test issuer',instrumentType:kind,currency:'USD',exchangeTimezoneName:'America/New_York',dataGranularity:interval,regularMarketTime:Date.parse('2026-10-21T20:00Z')/1000,regularMarketPrice:110,currentTradingPeriod:{regular:{start:Date.parse('2026-10-21T13:30Z')/1000,end:Date.parse('2026-10-21T20:00Z')/1000}}},timestamp:times.map(t=>t/1000),indicators:{quote:[{open:times.map(()=>100),high:times.map(()=>112),low:times.map(()=>99),close:times.map(()=>110),volume:times.map(()=>1000)}]}}]}};
}
test('retains three months of real hourly history and at least a month of small four-hour session bars',()=>{
 const result=buildAssetCandles('TEST',chart(),chart('1d'),chart('1wk'),[],now).data;
 assert.ok(result.series['4h']!.candles.length>100);const end=result.candles.at(-1)!.time,lastMonth=result.candles.filter(c=>c.time>=end-30*86400000);assert.ok(lastMonth.length>=40);assert.equal(result.series['1h']!.candles.length,result.candles.length*3.5);assert.equal(result.quoteAt,'2026-10-21T20:00:00.000Z');assert.equal(result.price,110);
});
test('a daily history is never relabelled as four-hour candles and indices carry no fictitious volume',()=>{
 const result=buildAssetCandles('^GSPC',chart('1d','INDEX'),chart('1d','INDEX'),chart('1wk','INDEX'),[],now).data;
 assert.equal(result.candles.length,0);assert.ok(result.series['1d']!.candles.length>60);assert.ok(result.series['1d']!.candles.every(c=>c.volume===null));assert.equal(result.instrument.priceUnit,'pts');
});
test('lightweight candle request has no news or AI calls and does not spend on a secondary source when hourly bars suffice',async()=>{
 const calls:string[]=[];const result=await fetchAssetCandles('TEST',{MASSIVE_API_KEY:'unit-test'},async url=>{calls.push(url);return chart(url.includes('60m')?'60m':url.includes('1wk')?'1wk':'1d');},now);
 assert.equal(calls.length,3);assert.ok(calls.some(url=>url.includes('range=3mo&interval=60m')));assert.ok(calls.every(url=>url.includes('/v8/finance/chart/')));assert.ok(result.data.candles.length>100);assert.equal('news' in result.data,false);
});
test('secondary four-hour bars are a complete, explicitly labelled fallback only for valid US securities',async()=>{
 const calls:string[]=[];const bars=Array.from({length:35},(_,i)=>({t:now-(35-i)*14400000,o:100,h:101,l:99,c:100,v:10}));
 const result=await fetchAssetCandles('TEST',{MASSIVE_API_KEY:'unit-test'},async url=>{calls.push(url);return url.includes('api.massive.com')?{results:bars}:url.includes('60m')?null:chart('1d');},now);
 assert.equal(calls.length,4);assert.equal(result.data.candles.length,35);assert.match(result.data.session,/fuera de la sesión regular/);assert.equal(result.data.series['1h']!.candles.length,0);
 calls.length=0;await fetchAssetCandles('SAP.DE',{MASSIVE_API_KEY:'unit-test'},async url=>{calls.push(url);return url.includes('60m')?null:chart('1d');},now);assert.equal(calls.length,3);
});
test('invalid future quote metadata cannot become an undated current price',()=>{
 const hourly=chart(),daily=chart('1d'),weekly=chart('1wk');for(const raw of[hourly,daily,weekly])raw.chart.result[0].meta.regularMarketTime=(now+3600000)/1000;
 const data=buildAssetCandles('TEST',hourly,daily,weekly,[],now).data;assert.equal(data.price,null);assert.equal(data.quoteAt,null);
});

test('closed daily sessions are complete and invalid timestamps are discarded before date formatting',()=>{
 const raw=chart('1d').chart.result[0];
 assert.equal(chartCandles(raw,86400000,now).at(-1)!.partial,false);
 assert.equal(chartCandles(raw,86400000,Date.parse('2026-10-21T17:00Z')).at(-1)!.partial,true);
 const count=chartCandles(raw,86400000,now).length;raw.timestamp.push(NaN,Infinity);
 assert.equal(chartCandles(raw,86400000,now).length,count);
});

test('descending hourly payloads keep chronological OHLC and invalid volume cannot become traded activity',()=>{
 const raw=chart().chart.result[0];
 const ascending=hourlyToFourHours(raw,now);
 raw.timestamp.reverse();for(const values of Object.values(raw.indicators.quote[0]))values.reverse();
 assert.deepEqual(hourlyToFourHours(raw,now),ascending);
 raw.indicators.quote[0].volume[0]=-1;assert.equal(hourlyToFourHours(raw,now).at(-1)!.volume,null);
});

test('a compressed 4H series triggers recovery even when it contains more than thirty bars',async()=>{
 const hourly=chart();hourly.chart.result[0].timestamp=hourly.chart.result[0].timestamp.slice(-126);for(const key of Object.keys(hourly.chart.result[0].indicators.quote[0]))hourly.chart.result[0].indicators.quote[0][key]=hourly.chart.result[0].indicators.quote[0][key].slice(-126);
 const backup=Array.from({length:100},(_,i)=>({t:now-(100-i)*43200000,o:100,h:101,l:99,c:100,v:10}));let called=false;
 const result=await fetchAssetCandles('TEST',{MASSIVE_API_KEY:'unit-test'},async url=>url.includes('api.massive.com')?(called=true,{results:backup}):url.includes('60m')?hourly:chart('1d'),now);
 assert.ok(called);assert.equal(result.data.candles.length,100);assert.match(result.data.session,/fuera/);
});

test('a live FX quote inside an hourly bucket is not a second candle or part of the four-hour OHLC',()=>{
 const start=Date.parse('2026-10-21T20:00Z'),quoteAt=Date.parse('2026-10-21T21:30:26Z'),meta={symbol:'EURUSD=X',instrumentType:'CURRENCY',exchangeTimezoneName:'UTC',regularMarketTime:quoteAt/1000};
 const raw={meta,timestamp:[start/1000,(start+3600000)/1000,quoteAt/1000],indicators:{quote:[{open:[1.1,1.11,1.9],high:[1.12,1.13,1.9],low:[1.09,1.1,1.9],close:[1.11,1.12,1.9],volume:[null,null,0]}]}};
 assert.equal(chartCandles(raw,3600000,now).length,2);
 const four=hourlyToFourHours(raw,now);assert.equal(four.length,1);assert.equal(four[0].close,1.12);assert.equal(four[0].high,1.13);
 // A real new bucket may start with a flat first tick; retain that bar.
 raw.timestamp[2]=(start+7200000)/1000;raw.meta.regularMarketTime=raw.timestamp[2];assert.equal(chartCandles(raw,3600000,now).length,3);
});

test('a zero-volume closing quote is not an extra hourly candle when metadata has a later quote time',()=>{
 const close=Date.parse('2026-10-21T20:00Z'),raw={meta:{symbol:'VRT',instrumentType:'EQUITY',exchangeTimezoneName:'America/New_York',regularMarketTime:(close+27*60000)/1000,currentTradingPeriod:{regular:{start:(close-6.5*3600000)/1000,end:close/1000}}},timestamp:[(close-1800000)/1000,close/1000],indicators:{quote:[{open:[213.55,212.15],high:[213.55,212.15],low:[212.08,212.15],close:[212.22,212.15],volume:[835353,0]}]}};
 const candles=chartCandles(raw,3600000,now);assert.equal(candles.length,1);assert.equal(candles[0].close,212.22);
});
