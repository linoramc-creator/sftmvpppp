import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeMacroIndex,eodhdMacroIndices,comparableStressPercentiles,realizedYieldVolatility,buildBondsMacroIndicators} from '../supabase/functions/analyze-ticker/macro-indicators.ts';
import type {CreditSeries} from '../supabase/functions/analyze-ticker/bonds-credit.ts';
import type {eodhdGet} from '../supabase/functions/analyze-ticker/eodhd-client.ts';
const now=Date.parse('2026-10-21T15:00Z');
const series=(id:string,values:number[],start='2025-01-01'):CreditSeries=>{const points:{date:string;value:number}[]=[];let time=Date.parse(start);for(const value of values){while([0,6].includes(new Date(time).getUTCDay()))time+=86400000;points.push({date:new Date(time).toISOString().slice(0,10),value});time+=86400000;}return {id,label:id,unit:'%',frequency:'daily',currency:null,scope:'derived',source:'',points};};
test('MOVE is only the actual published index and its unit never becomes a USD quote, synthetic yield statistic or invented options volume',()=>{
 const data=normalizeMacroIndex('MOVE.INDX',[{date:'2026-10-20',close:101.7,volume:0},{date:'2026-10-21',close:999},{date:'2026-10-17',close:99},{date:'2026-02-30',close:99},{date:'2026-10-19',close:0}],now)!;
 assert.equal(data.id,'MOVE.INDX');assert.equal(data.unit,'puntos');assert.equal(data.currency,null);assert.deepEqual(data.points,[{date:'2026-10-20',value:101.7}]);assert.equal((data as any).volume,undefined);
 assert.equal(normalizeMacroIndex('US10Y.GBOND',[{date:'2026-10-20',close:4}],now),null);
});
test('MOVE and VIX discovery uses only two cached exact-symbol histories and preserves partial provider coverage',async()=>{
 const calls:string[]=[];
 const request=(async(path:string,query:any,options:any)=>{calls.push(path);assert.equal(options.cost,1);assert.equal(options.ttlMs,21600000);assert.equal(query.to,'2026-10-20');return path.endsWith('MOVE.INDX')?[{date:'2026-10-20',close:101.7}]:null;}) as typeof eodhdGet;
 const rows=await eodhdMacroIndices(request,now);assert.deepEqual(calls,['eod/MOVE.INDX','eod/VIX.INDX']);assert.equal(rows.length,1);assert.equal(rows[0].id,'MOVE.INDX');
});
test('cross-asset stress uses matching dates and rolling own distributions without look-ahead or a misleading MOVE/VIX ratio',()=>{
 const values=Array.from({length:260},(_,i)=>i+1),move=series('MOVE.INDX',values),vix=series('VIX.INDX',values.map(n=>261-n));
 vix.points.splice(10,1);
 const output=comparableStressPercentiles(move,vix);assert.equal(output.length,2);assert.equal(output[0].points.length,8);assert.equal(output[0].points[0].value,100);assert.equal(output[1].points[0].value,100/252);assert.equal(output[0].points[0].date,move.points[252].date);
 const old=output[0].points[0];move.points.at(-1)!.value=99999;
 assert.deepEqual(comparableStressPercentiles(move,vix)[0].points[0],old);
 assert.deepEqual(comparableStressPercentiles(move,null),[]);
});
test('realized yield volatility uses absolute basis-point changes and sample dispersion, retaining valid zero volatility',()=>{
 const levels=[4];for(let i=1;i<=20;i++)levels.push(levels.at(-1)!+i/100);
 const value=realizedYieldVolatility(series('DGS10',levels,'2026-09-01'),'US · 10 años');
 assert.equal(value.unit,'pb/día');assert.equal(value.points.length,1);assert.ok(Math.abs(value.points[0].value-Math.sqrt(35))<1e-9);assert.ok(!value.label.includes('MOVE'));
 assert.equal(realizedYieldVolatility(series('DGS10',Array(21).fill(4),'2026-09-01'),'US').points[0].value,0);
});
test('inflation and HY/IG premia align the same actual dates and convert spreads from percentage points to basis points',()=>{
 const nominal=series('DGS10',[5,5.1]),real=series('DFII10',[2.5,2.6]),hy=series('BAMLH0A0HYM2',[4,4.1]),ig=series('BAMLC0A0CM',[1]);
 const result=buildBondsMacroIndicators([nominal,real,hy,ig],null,[]);
 assert.equal(result.move,null);assert.equal(result.breakevens[0].points[0].value,2.5);assert.equal(result.breakevens[0].unit,'%');
 assert.deepEqual(result.hyIgPremium.points,[{date:'2025-01-01',value:300}]);assert.equal(result.hyIgPremium.unit,'pb');
});
