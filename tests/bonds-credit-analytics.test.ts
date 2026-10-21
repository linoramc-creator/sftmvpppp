import {test} from 'node:test';
import assert from 'node:assert/strict';
import {yieldCurveSnapshots,alignedTransform,creditSpreadStat,buildBondsCreditAnalytics} from '../supabase/functions/analyze-ticker/bonds-credit-analytics.ts';
import {massiveTreasurySeries,buildBondsCredit,type CreditSeries} from '../supabase/functions/analyze-ticker/bonds-credit.ts';
import type {BondsPanel,Series,Point} from '../supabase/functions/analyze-ticker/panels.ts';
const series=(id:string,points:Point[],unit='%'):Series=>({id,label:id,unit,source:'official:'+id,points});
const credit=(id:string,points:Point[],unit='%'):CreditSeries=>({...series(id,points,unit),frequency:'daily',scope:'financial-conditions',currency:null});
const base=(rows:Series[]):BondsPanel=>({fetchedAt:'2026-10-20T10:00Z',series:rows,etfs:[]});

test('curve snapshots use the same actual observation date for every tenor, and bounded prior calendar anniversaries',()=>{
 const dates=['2025-10-17','2026-09-18','2026-10-16','2026-10-19'];
 const rows=['DGS3MO','DGS2','DGS10','DGS30'].map((id,i)=>series(id,dates.flatMap((date,j)=>id==='DGS30'&&date==='2026-10-19'?[]:[{date,value:i+j}])));
 const snapshots=yieldCurveSnapshots(rows);
 assert.deepEqual(snapshots.map(s=>[s.key,s.date]),[['current','2026-10-16']]);
 // The calendar targets are Sep 16 and Oct 16; later observations must never
 // be borrowed even when they are only one or two days after the target.
 assert.equal(snapshots.length,1);assert.deepEqual(snapshots[0].points.map(p=>p.value),[2,3,4,5]);
 const full=yieldCurveSnapshots(rows.map(s=>({...s,points:[{date:'2025-10-16',value:2},{date:'2026-09-16',value:3},...s.points]})));
 assert.deepEqual(full.map(s=>s.date),['2026-10-16','2026-09-16','2025-10-16']);
});

test('a stale tenor cannot silently pull today’s entire curve several weeks into the past',()=>{
 const rows=['DGS2','DGS10','DGS30'].map((id,i)=>series(id,[{date:'2026-09-30',value:i},...(id==='DGS30'?[]:[{date:'2026-10-19',value:i+1}])]));
 assert.deepEqual(yieldCurveSnapshots(rows),[]);assert.deepEqual(yieldCurveSnapshots(rows.slice(0,2)),[]);
});

test('curve differences convert annual percentage points to basis points and never join mismatched dates',()=>{
 const a=series('DGS10',[{date:'2026-10-16',value:5.09},{date:'2026-10-19',value:5.15}]);
 const b=series('DGS2',[{date:'2026-10-15',value:4.7},{date:'2026-10-19',value:4.77}]);
 const result=alignedTransform('slope','10–2','pb',a,b,(a,b)=>(a-b)*100);
 assert.equal(result.points.length,1);assert.equal(result.points[0].date,'2026-10-19');assert.ok(Math.abs(result.points[0].value-38)<1e-10);
});

test('spread changes and percentile report their actual sample window and require sufficient history',()=>{
 const points=Array.from({length:120},(_,i)=>({date:new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),value:100+i}));
 const result=creditSpreadStat(credit('HY',points,'pb'));
 assert.equal(result.change21Bp,21);assert.equal(result.change63Bp,63);assert.equal(result.percentile,100);assert.equal(result.observations,120);assert.equal(result.windowStart,'2026-01-01');
 const short=creditSpreadStat(credit('HY',points.slice(0,20),'pb'));assert.equal(short.percentile,null);assert.equal(short.change21Bp,null);
 const empty=creditSpreadStat(credit('HY',[],'pb'));assert.equal(empty.value,null);assert.equal(empty.date,null);assert.equal(empty.windowStart,null);
});

test('private capital ratios use identical quarters and retain their distinct economic meanings',()=>{
 const q='2026-04-01',rows=[credit('BOGZ1FL444090000Q',[{date:q,value:1000}]),credit('BOGZ1FL444190005Q',[{date:q,value:400}]),credit('BOGZ1FL442000093Q',[{date:q,value:300},{date:'2026-07-01',value:500}]),credit('BOGZ1FL443067205Q',[{date:q,value:600}])];
 const analytics=buildBondsCreditAnalytics(base([]),rows);
 assert.equal(analytics.privateLeverage.unit,'x');assert.ok(Math.abs(analytics.privateLeverage.points[0].value-2/3)<1e-10);
 assert.deepEqual(analytics.privateDryPowderRatio.points,[{date:q,value:50}]);
 assert.ok(!/impago|PIK|efectivo|rentabilidad|retorno/i.test(analytics.privateDryPowderRatio.label));
 const insolvent=buildBondsCreditAnalytics(base([]),[credit('BOGZ1FL444090000Q',[{date:q,value:400}]),credit('BOGZ1FL444190005Q',[{date:q,value:400}])]);assert.deepEqual(insolvent.privateLeverage.points,[]);
});

test('country spread histories compare like monthly 10-year observations without mixing their latest dates',()=>{
 const rows=[credit('IRLTLT01FRM156N',[{date:'2026-08-01',value:3.5},{date:'2026-09-01',value:3.7}]),credit('IRLTLT01DEM156N',[{date:'2026-08-01',value:2.7}])];
 const result=buildBondsCreditAnalytics(base([]),rows).sovereignSpreadHistory.find(s=>s.id==='FR_DE_10Y')!;
 assert.equal(result.frequency,'monthly');assert.equal(result.unit,'pb');assert.equal(result.points.length,1);assert.ok(Math.abs(result.points[0].value-80)<1e-10);
});

test('Massive Treasury backup preserves real zero and negative rates, dates, and missing tenors',()=>{
 const rows=massiveTreasurySeries({results:[{date:'2026-10-19',yield_1_month:0,yield_2_year:-.1,yield_10_year:5.15,yield_20_year:null},{date:'2026-10-20',yield_10_year:'5.2'},{date:'2030-01-01',yield_10_year:6}]},Date.parse('2026-10-20'));
 assert.deepEqual(rows.find(s=>s.id==='DGS1MO')?.points,[{date:'2026-10-19',value:0}]);assert.deepEqual(rows.find(s=>s.id==='DGS2')?.points,[{date:'2026-10-19',value:-.1}]);assert.deepEqual(rows.find(s=>s.id==='DGS20')?.points,[]);
 assert.deepEqual(rows.find(s=>s.id==='DGS10')?.points,[{date:'2026-10-19',value:5.15},{date:'2026-10-20',value:5.2}]);
});

test('existing IG and HY points remain unchanged while analytics express their spreads in basis points',()=>{
 const b=base([series('BAMLC0A0CM',[{date:'2026-10-19',value:.88}]),series('BAMLH0A0HYM2',[{date:'2026-10-19',value:3.1}])]);
 const panel=buildBondsCredit(b,[]);assert.equal(panel.base.series[0].points[0].value,.88);assert.equal(panel.analytics?.creditSpreads[0].points[0].value,88);assert.equal(panel.analytics?.creditSpreads[1].points[0].value,310);
 assert.ok(panel.analytics?.creditSpreads.every(s=>!/BB|CCC/.test(s.id)));
});
