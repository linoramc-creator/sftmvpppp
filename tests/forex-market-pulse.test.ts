import {test} from 'node:test';
import assert from 'node:assert/strict';
import {instrumentInfo} from '../supabase/functions/analyze-ticker/asset-instrument.ts';
import {buildMarketPulse,massiveFxChart,pulseChartData} from '../supabase/functions/analyze-ticker/market-pulse.ts';

const now=Date.parse('2026-10-16T12:00:00Z'),date=Date.parse('2026-10-16T00:00:00Z');
function chart(type='CURRENCY',intraday=false){
 const times=intraday?[date,date+300000,date+600000]:Array.from({length:81},(_,i)=>date-(80-i)*86400000);
 const closes=times.map((_,i)=>1.1+i*.0002+(i%2?-.0001:.0001));
 return {chart:{result:[{meta:{symbol:'EURUSD=X',instrumentType:type,currency:'USD',exchangeTimezoneName:'UTC',regularMarketTime:now/1000,regularMarketPrice:1.12345,regularMarketVolume:1000000,dataGranularity:intraday?'5m':'1d',currentTradingPeriod:{regular:{start:date/1000,end:(date+86400000)/1000}}},timestamp:times.map(t=>t/1000),indicators:{quote:[{open:closes.map(c=>c-.0002),high:closes.map(c=>c+.001),low:closes.map(c=>c-.001),close:closes,volume:closes.map(()=>100000)}]}}]}};
}
test('FX instruments preserve base/quote direction, decimal precision, and unavailable consolidated volume',()=>{
 const eur=instrumentInfo({instrumentType:'CURRENCY',currency:'USD'},'EURUSD=X');
 assert.equal(eur.kind,'forex');assert.equal(eur.baseCurrency,'EUR');assert.equal(eur.quoteCurrency,'USD');assert.equal(eur.priceDecimals,5);assert.equal(eur.volumeUnit,'unavailable');
 const yen=instrumentInfo({instrumentType:'CURRENCY',currency:'JPY'},'JPY=X');
 assert.equal(yen.baseCurrency,'USD');assert.equal(yen.quoteCurrency,'JPY');assert.equal(yen.priceDecimals,3);
 assert.equal(instrumentInfo({},'EURJPY=X').baseCurrency,'EUR');
 const crypto=instrumentInfo({instrumentType:'CRYPTOCURRENCY',currency:'USD'},'BTC-USD');assert.equal(crypto.kind,'crypto');assert.equal(crypto.baseCurrency,'BTC');assert.equal(crypto.volumeUnit,'unavailable');
});
test('FX market pulse computes dated trend and risk from native closes, excluding the open daily bar',()=>{
 const result=buildMarketPulse('EURUSD=X',chart(),chart('CURRENCY',true),undefined,now);
 assert.equal(result.name,'EUR / USD');assert.equal(result.currency,'USD');assert.equal(result.price,1.12345);
 assert.equal(result.risk.asOf,'2026-10-15');assert.equal(result.trend.date,'2026-10-15');assert.equal(result.risk.annualizationDays,252);
 assert.ok(result.risk.history.at(-1)!.vol20!>0);assert.ok(result.trend.return20!>0);assert.ok(result.trend.ma50!>1);
 assert.equal(result.session.partial,true);assert.equal(result.session.volume,null);assert.equal(result.session.averageVolume20,null);assert.equal(result.session.volumeRatio,null);assert.equal(result.vwapApprox,null);
 assert.ok(result.daily.every(c=>c.volume===null));assert.ok(result.intraday.candles.every(c=>c.volume===null));assert.equal(result.intraday.volume.length,0);assert.ok(result.risk.history.every(p=>p.volumeRatio===null));
});
test('crypto uses calendar-day annualization and still does not invent a consolidated trading volume',()=>{
 const fx=buildMarketPulse('EURUSD=X',chart(),null,undefined,now),crypto=buildMarketPulse('BTC-USD',chart('CRYPTOCURRENCY'),null,undefined,now);
 assert.equal(crypto.risk.annualizationDays,365);assert.ok(Math.abs(crypto.risk.history.at(-1)!.vol20!/fx.risk.history.at(-1)!.vol20!-Math.sqrt(365/252))<1e-10);assert.equal(crypto.session.volume,null);assert.ok(crypto.trend.ma20!>0);
});
test('healthy native FX history never calls the additional provider',async()=>{
 const urls:string[]=[];const result=await pulseChartData('EURUSD=X',{MASSIVE_API_KEY:'test-only'},async url=>{urls.push(url);return chart('CURRENCY',url.includes('interval=5m'));},now);
 assert.equal(urls.length,2);assert.ok(urls.every(url=>url.startsWith('https://query1.finance.yahoo.com/')));assert.ok(result.daily);
});
test('additional FX provider replaces both streams with UTC quote bars and discards quote counts',async()=>{
 const urls:string[]=[],intraday={results:[{t:date+300000,o:1.12,h:1.13,l:1.11,c:1.124,v:999999,n:999999}]},daily={results:[{t:date-86400000,o:1.11,h:1.13,l:1.1,c:1.12,v:999999}]};
 const raw=await pulseChartData('EURUSD=X',{MASSIVE_API_KEY:'test-only'},async(url,headers)=>{urls.push(url);if(url.includes('yahoo.com'))return null;assert.equal(headers?.Authorization,'Bearer test-only');return url.includes('/range/1/day/')?daily:intraday;},now);
 assert.equal(urls.length,4);assert.ok(urls.every(url=>!url.includes('test-only')));
 const result=buildMarketPulse('EURUSD=X',raw.daily,raw.intraday,undefined,now);
 assert.equal(result.timezone,'UTC');assert.equal(result.dataOrigin,'massive-fx');assert.equal(result.quoteBasis,'bar-close');assert.equal(result.price,1.124);assert.equal(result.quoteAt,'2026-10-16T00:09:59.999Z');assert.equal(result.intraday.candles[0].volume,null);assert.equal(result.session.volume,null);
});
test('provider denial preserves valid native history and does not relabel empty bars as data',async()=>{
 const native=chart();const result=await pulseChartData('EURUSD=X',{MASSIVE_API_KEY:'test-only'},async url=>url.includes('interval=1d')?native:url.includes('massive.com')?{status:'NOT_AUTHORIZED'}:null,now);
 assert.equal(result.daily,native);assert.equal(result.intraday,null);assert.equal(massiveFxChart({results:[]},'EURUSD=X',5,now),null);
});
test('FX fallback quotes only a completed five-minute bar, while retaining the partial bar for the chart',()=>{
 const at=date+420000,raw=massiveFxChart({results:[{t:date,o:1.1,h:1.2,l:1,c:1.12},{t:date+300000,o:1.12,h:1.3,l:1.1,c:1.25}]},'EURUSD=X',5,at);
 assert.equal(raw?.chart.result[0].meta.regularMarketPrice,1.12);assert.equal(raw?.chart.result[0].timestamp.length,2);assert.equal(raw?.chart.result[0].meta.regularMarketTime,(date+300000-1)/1000);
});
