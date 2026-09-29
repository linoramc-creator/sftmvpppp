import assert from 'node:assert/strict';
import {risk,pearson,correlations} from '../supabase/functions/analyze-ticker/market-analytics.ts';
assert.equal(pearson([1,2,3],[3,2,1]),-1);
assert.equal(pearson([1,1,1],[2,3,4]),null);
assert.equal(risk([100,120,90,108]).maxDrawdown,-25);
assert.equal(risk([100,120]).volatility,null);
assert.equal(risk([]).totalReturn,null);
const oldFetch=globalThis.fetch;
globalThis.fetch=async url=>{
 const symbol=decodeURIComponent(String(url).split('/chart/')[1].split('?')[0]);
 if(symbol==='MISSING')return new Response('{}',{status:404});
 const timestamps=Array.from({length:45},(_,i)=>Date.UTC(2026,0,1+i)/1000);
 const close=timestamps.map((_,i)=>100+i+Math.sin(i));
 const adjusted=close.map((v,i)=>symbol==='URTH'&&i===4?null:v);
 return Response.json({chart:{result:[{timestamp:timestamps,meta:{currency:'USD'},indicators:{quote:[{close,volume:close.map(()=>100)}],adjclose:[{adjclose:adjusted}]}}]}});
};
try{
 const result=await correlations(['QQQ','MISSING'],'3m');
 assert.deepEqual(result.symbols,['QQQ','SPY','URTH']);
 assert.deepEqual(result.missing,['MISSING']);
 assert.equal(result.observations,43); // A missing date is excluded, never filled.
 assert.equal(result.rolling.length,24);
 assert.ok(result.metrics.every(m=>Math.abs(m.betaSP500-1)<1e-10));
 assert.ok(result.metrics.every(m=>Math.abs(m.trackingErrorSP500)<1e-10));
 assert.ok(result.correlation.every(row=>row.every(v=>Math.abs(v-1)<1e-10)));
 assert.ok(result.chart.every(row=>Object.values(row).every(v=>typeof v==='string'||Number.isFinite(v))));
}finally{globalThis.fetch=oldFetch;}
console.log('PASS: risk, constant series, drawdown, benchmark alignment, missing data, rolling correlation, beta and tracking error');
