import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPortfolioAnalytics,portfolioAssetRisk,normalizePortfolioHistory,normalizeMassivePortfolioHistory,createPortfolioHistoryLoader,type PortfolioHistory} from '../supabase/functions/analyze-ticker/portfolio-analytics.ts';
import {createPortfolioState,portfolioTradingDay,portfolioRegularEnd} from '../supabase/functions/analyze-ticker/portfolio-model.ts';
const now=Date.parse('2026-11-10T15:00:00Z'),DAY=86400000;
function days(count:number,last='2026-11-09'){const rows:string[]=[];for(let d=last;rows.length<count;d=new Date(Date.parse(d)-DAY).toISOString().slice(0,10))if(portfolioTradingDay(d))rows.unshift(d);return rows;}
const history=(count=100):PortfolioHistory=>({symbol:'AAPL',adjustment:'total-return',points:days(count).map((date,i)=>({date,value:100*Math.exp(i*.0003+Math.sin(i)*.015)}))});
function chart(h=history()){return {chart:{result:[{meta:{symbol:h.symbol,currency:'USD',instrumentType:'EQUITY',exchangeTimezoneName:'America/New_York',dataGranularity:'1d'},timestamp:h.points.map(p=>(portfolioRegularEnd(p.date)-6.5*3600000)/1000),indicators:{quote:[{close:h.points.map(p=>p.value)}],adjclose:[{adjclose:h.points.map(p=>p.value)}]}}]}};}
function massive(h=history()){return {ticker:h.symbol,status:'OK',adjusted:true,results:h.points.map(p=>({t:portfolioRegularEnd(p.date)-16*3600000,o:p.value,h:p.value+1,l:p.value-1,c:p.value}))};}
const metrics=(values:number[])=>{const mean=values.reduce((sum,v)=>sum+v,0)/values.length,sd=Math.sqrt(values.reduce((sum,v)=>sum+(v-mean)**2,0)/(values.length-1));return {sd,sharpe:mean/sd*Math.sqrt(252)};};

test('portfolio risk needs complete consecutive observed daily TWR, never intraday sample count',async()=>{
 const state=createPortfolioState(10000,now-DAY),start=Date.parse('2026-11-09T15:00:00Z');state.snapshots=Array.from({length:100},(_,i)=>({at:start+i*60000,equity:10000+i,cash:10000,externalFlow:0,returnFactor:1+i/10000,benchmark:null}));
 let calls=0;const result=await buildPortfolioAnalytics(state,now,{history:async()=>{calls++;return null;}});assert.equal(result.portfolio.status,'insufficient');assert.equal(result.portfolio.sharpe,null);assert.equal(result.portfolio.annualizedVolatilityPct,null);assert.equal(result.portfolio.observations,0);assert.equal(calls,0);assert.match(result.notes.join(' '),/0 %/);
 const dates=days(21);state.snapshots=dates.map((date,i)=>({at:portfolioRegularEnd(date)+4*3600000+60000,valuationAt:portfolioRegularEnd(date)+4*3600000,equity:10000*Math.exp(i*.0003+Math.sin(i)*.015),cash:10000,externalFlow:i%2?100:-100,returnFactor:Math.exp(i*.0003+Math.sin(i)*.015),benchmark:null}));
 const ready=await buildPortfolioAnalytics(state,now),returns=state.snapshots.slice(1).map((p,i)=>p.returnFactor!/state.snapshots[i].returnFactor!-1),expected=metrics(returns);assert.equal(ready.portfolio.status,'ready');assert.equal(ready.portfolio.observations,20);assert.ok(Math.abs(ready.portfolio.sharpe!-expected.sharpe)<1e-10);assert.ok(Math.abs(ready.portfolio.annualizedVolatilityPct!-expected.sd*Math.sqrt(252)*100)<1e-10);assert.equal(ready.portfolio.from,dates[0]);assert.equal(ready.portfolio.to,dates.at(-1));assert.equal(ready.portfolio.riskFreeRatePct,0);
 state.snapshots.splice(15,1);const missing=await buildPortfolioAnalytics(state,now);assert.equal(missing.portfolio.status,'insufficient');assert.equal(missing.portfolio.sharpe,null);
});

test('invalid TWR and missing sessions break the chain instead of bridging or reconstructing returns',async()=>{
 const state=createPortfolioState(10000,now-50*DAY),dates=days(25);state.snapshots=dates.map((date,i)=>({at:portfolioRegularEnd(date)+4*3600000+60000,valuationAt:portfolioRegularEnd(date)+4*3600000,equity:10000,cash:10000,externalFlow:0,returnFactor:i===20?null:1+i*.001,benchmark:null}));
 const result=await buildPortfolioAnalytics(state,now);assert.equal(result.portfolio.observations,3);assert.equal(result.portfolio.status,'insufficient');
 state.snapshots=dates.map(date=>({at:portfolioRegularEnd(date)+4*3600000+60000,valuationAt:portfolioRegularEnd(date)+4*3600000,equity:10000,cash:10000,externalFlow:0,returnFactor:1,benchmark:null}));const flat=await buildPortfolioAnalytics(state,now);assert.equal(flat.portfolio.status,'ready');assert.equal(flat.portfolio.annualizedVolatilityPct,0);assert.equal(flat.portfolio.sharpe,null);
});

test('a server timestamp after closing never upgrades a legacy, previous-day or intraday quote into a daily close',async()=>{
 const state=createPortfolioState(10000,now-50*DAY),dates=days(25),snapshots=dates.map((date,i)=>({at:portfolioRegularEnd(date)+4*3600000+60000,valuationAt:portfolioRegularEnd(date)+4*3600000,equity:10000,cash:10000,externalFlow:0,returnFactor:1+i*.001,benchmark:null}));
 for(const invalid of [undefined,null,portfolioRegularEnd(dates[19]),portfolioRegularEnd(dates[20])-60000,snapshots[20].at+1]){
  state.snapshots=snapshots.map((row,i)=>i===20?{...row,valuationAt:invalid}:row);const result=await buildPortfolioAnalytics(state,now);assert.equal(result.portfolio.status,'insufficient');assert.equal(result.portfolio.sharpe,null);assert.equal(result.portfolio.observations,3);
 }
 state.snapshots=snapshots.map(({valuationAt,...legacy})=>legacy);const legacy=await buildPortfolioAnalytics(state,now);assert.equal(legacy.portfolio.observations,0);assert.equal(legacy.portfolio.status,'insufficient');assert.match(legacy.notes.join(' '),/fecha de mercado verificable/);
});

test('assets use a twenty-session log-volatility window and arithmetic Sharpe with genuine adjusted dates',()=>{
 const h=history(),risk=portfolioAssetRisk('AAPL',h,now),window=h.points.slice(-21),logs=window.slice(1).map((p,i)=>Math.log(p.value/window[i].value)),simple=window.slice(1).map((p,i)=>p.value/window[i].value-1);
 assert.equal(risk.observations,20);assert.equal(risk.from,window[0].date);assert.equal(risk.to,window.at(-1)!.date);assert.equal(risk.rolling.length,80);assert.ok(Math.abs(risk.annualizedVolatilityPct!-metrics(logs).sd*Math.sqrt(252)*100)<1e-10);assert.ok(Math.abs(risk.sharpe!-metrics(simple).sharpe)<1e-10);assert.equal(risk.adjustment,'total-return');
 const gap={...h,points:h.points.filter((_,i)=>i!==95)},missing=portfolioAssetRisk('AAPL',gap,now);assert.equal(missing.annualizedVolatilityPct,null);assert.equal(missing.sharpe,null);assert.equal(missing.observations,3);
 assert.equal(portfolioAssetRisk('AAPL',history(20),now).sharpe,null);
 const mismatch=portfolioAssetRisk('AAPL',{...h,symbol:'MSFT'},now);assert.equal(mismatch.observations,0);
});

test('history validates identity, adjustment and unfinished daily bars; split-only source stays separate',()=>{
 const raw=chart(),normalized=normalizePortfolioHistory('AAPL',raw,now);assert.equal(normalized?.points.length,100);assert.equal(normalized?.adjustment,'total-return');
 for(const field of [{symbol:'MSFT'},{currency:'EUR'},{instrumentType:'INDEX'},{exchangeTimezoneName:'Europe/London'},{dataGranularity:'1m'}]){const invalid=structuredClone(raw);Object.assign(invalid.chart.result[0].meta,field);assert.equal(normalizePortfolioHistory('AAPL',invalid,now),null);}
 const absent=structuredClone(raw);absent.chart.result[0].indicators.adjclose[0].adjclose[10]=null as any;assert.equal(normalizePortfolioHistory('AAPL',absent,now),null);
 const today=chart({...history(),points:[...history().points,{date:'2026-11-10',value:999}]});assert.equal(normalizePortfolioHistory('AAPL',today,now)?.points.length,100);
 const aggs=massive();assert.equal(normalizeMassivePortfolioHistory('AAPL',aggs,now)?.adjustment,'splits');assert.equal(normalizeMassivePortfolioHistory('AAPL',{...aggs,adjusted:false},now),null);assert.equal(normalizeMassivePortfolioHistory('AAPL',{...aggs,ticker:'MSFT'},now),null);
});

test('loader prioritizes one complete source, coalesces five-minute requests and cools failures for thirty seconds',async()=>{
 const calls:string[]=[],loader=createPortfolioHistoryLoader({primary:async()=>{calls.push('primary');await Promise.resolve();return chart();},massive:async()=>{calls.push('massive');return massive();},fallback:async()=>{calls.push('fallback');return chart();}});
 const [a,b]=await Promise.all([loader('AAPL',now),loader('AAPL',now)]);assert.deepEqual(a,b);assert.deepEqual(calls,['primary']);await loader('AAPL',now+299999);assert.equal(calls.length,1);await loader('AAPL',now+300000);assert.equal(calls.length,2);
 const fallbackCalls:string[]=[],fallback=createPortfolioHistoryLoader({primary:async()=>{fallbackCalls.push('primary');return chart(history(3));},massive:async()=>{fallbackCalls.push('massive');return massive();},fallback:async()=>{fallbackCalls.push('fallback');return chart();}});assert.equal((await fallback('AAPL',now))?.adjustment,'splits');assert.deepEqual(fallbackCalls,['primary','massive']);
 let failures=0;const failure=createPortfolioHistoryLoader({primary:async()=>{failures++;return null;},massive:async()=>null,fallback:async()=>null});assert.equal(await failure('AAPL',now),null);await failure('AAPL',now+29999);assert.equal(failures,1);await failure('AAPL',now+30000);assert.equal(failures,2);
});

test('only held, previously verified USD stock/ETF symbols are loaded and there are never more than twenty',async()=>{
 const state=createPortfolioState(10000,now-DAY);state.positions=Array.from({length:22},(_,i)=>({symbol:'A'+String.fromCharCode(65+i),name:'Asset',quantity:i===0?-1:1,averageCost:100,costBasis:i===0?-100:100,realizedPnl:0,dividends:0}));state.marks=state.positions.slice(0,19).map(p=>({symbol:p.symbol,name:p.name,currency:'USD',kind:'stock',price:100,at:now-60000,session:'regular',delaySeconds:60,tradable:true}));
 const loaded:string[]=[];let running=0,peak=0;const result=await buildPortfolioAnalytics(state,now,{history:async symbol=>{loaded.push(symbol);running++;peak=Math.max(peak,running);await Promise.resolve();running--;return {...history(),symbol};}});assert.equal(result.assets.length,20);assert.equal(loaded.length,19);assert.ok(loaded.includes('AA'));assert.ok(peak<=4);assert.equal(result.assets.at(-1)?.annualizedVolatilityPct,null);assert.match(result.notes.join(' '),/identidad/);
});
