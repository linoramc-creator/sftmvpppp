import test from 'node:test';
import assert from 'node:assert/strict';
import {executeAnalytics,validateAnalyticsQuery,AnalyticsValidationError} from '../supabase/functions/analyze-ticker/analytics-engine.ts';
import type {AnalyticsFundamentalInput,AnalyticsPriceInput,AnalyticsQuery,AnalyticsSource} from '../supabase/functions/analyze-ticker/analytics-types.ts';
const now=Date.parse('2026-11-11T12:00:00Z');
const source=(id='test',exportAllowed=true):AnalyticsSource=>({id,name:'Fuente de prueba',url:'https://example.com/financials',fetchedAt:new Date(now).toISOString(),dataThrough:'2026-09-30',exportAllowed,exportNote:'Fixture, no datos reales.'});
const priceQuery=(extra:Partial<AnalyticsQuery>={}):AnalyticsQuery=>({version:1,assets:['MSFT','^GSPC'],metric:'price',operation:'base100',period:{range:'2y'},frequency:'daily',currency:'original',chart:'line',dataKind:'reported',...extra});
const financialQuery=(extra:Partial<AnalyticsQuery>={}):AnalyticsQuery=>({...priceQuery(),assets:['MSFT'],metric:'revenue',operation:'level',frequency:'quarterly',...extra});
const portfolioQuery=(extra:Partial<AnalyticsQuery>={}):AnalyticsQuery=>({...priceQuery(),assets:[],metric:'portfolioExposure',operation:'level',frequency:'daily',chart:'bar',...extra});
const p=(symbol:string,values:[string,number][],extra:Partial<AnalyticsPriceInput>={}):AnalyticsPriceInput=>({symbol,currency:'USD',points:values.map(([date,value])=>({date,value})),source:source('price:'+symbol),adjustment:'split-adjusted-price',...extra});
const f=(symbol:string,rows:AnalyticsFundamentalInput['rows'],extra:Partial<AnalyticsFundamentalInput>={}):AnalyticsFundamentalInput=>({symbol,rows,source:source('fund:'+symbol),...extra});
const row=(date:string,values:Record<string,number|null>,extra:Partial<AnalyticsFundamentalInput['rows'][number]>={}):AnalyticsFundamentalInput['rows'][number]=>({date,currency:'USD',filingDate:date,periodType:'3M',values,...extra});

test('catalog rejects arbitrary expressions, SQL fields, extra nested properties and incompatible operations',()=>{
  for(const extra of [{sql:'select * from users'},{metric:'eval(1)'},{operation:'execute'},{period:{range:'2y',code:'alert(1)'}},{metric:'revenue',operation:'base100',frequency:'quarterly'},{metric:'price',operation:'ratio',denominator:'revenue'},{metric:'totalDebt',operation:'ratio',denominator:'revenue',frequency:'quarterly'}])assert.throws(()=>validateAnalyticsQuery({...priceQuery(),...extra}),AnalyticsValidationError);
  assert.throws(()=>validateAnalyticsQuery(priceQuery({assets:['AAPL;DROP']})),AnalyticsValidationError);
  assert.throws(()=>validateAnalyticsQuery(priceQuery({assets:Array(9).fill('MSFT')})),AnalyticsValidationError);
});
test('Alphabet share classes are never counted twice and one explicit canonical class is retained',()=>{
  assert.deepEqual(validateAnalyticsQuery(priceQuery({assets:['GOOG','GOOGL','MSFT']})).assets,['GOOGL','MSFT']);
});
test('base100 intersects observed dates and uses a single starting date, not independent IPO rebasing',async()=>{
  const histories={MSFT:p('MSFT',[['2026-01-01',100],['2026-01-02',200],['2026-01-05',220]]),'^GSPC':p('^GSPC',[['2026-01-02',50],['2026-01-05',55]])};
  const out=await executeAnalytics(priceQuery(),{now,prices:async s=>histories[s]});
  assert.deepEqual(out.table.map(r=>r.date),['2026-01-02','2026-01-05']);
  assert.equal(out.table[0].values.MSFT,100);assert.equal(out.table[0].values['^GSPC'],100);assert.ok(Math.abs(out.table[1].values.MSFT!-110)<1e-10);
  assert.ok(out.methodology.some(n=>n.includes('no es rentabilidad total')));assert.equal(out.export.chart,true);assert.equal(out.export.table,true);
});
test('base100 keeps partial authorized assets without inventing missing asset values',async()=>{
  const out=await executeAnalytics(priceQuery(),{now,prices:async s=>s==='MSFT'?p(s,[['2026-01-02',100],['2026-01-05',110]]):null});
  assert.equal(out.status,'partial');assert.equal(out.table[0].values['^GSPC'],null);assert.equal(out.series[1].status,'unavailable');assert.equal(out.series[1].points.length,0);
});
test('unadjusted raw prices cannot produce a misleading base100 through stock splits',async()=>{
  const out=await executeAnalytics(priceQuery({assets:['MSFT']}),{now,prices:async s=>p(s,[['2026-01-02',200],['2026-01-05',100]],{adjustment:'unadjusted-price'})});
  assert.equal(out.status,'unavailable');assert.equal(out.export.chart,false);assert.ok(out.series[0].notes.some(n=>n.includes('splits')));
});
test('weekly base100 starts the first visible sampled observation at100 and does not interpolate holidays',async()=>{
  const out=await executeAnalytics(priceQuery({assets:['MSFT'],frequency:'weekly'}),{now,prices:async s=>p(s,[['2026-01-05',100],['2026-01-09',110],['2026-01-14',121]])});
  assert.deepEqual(out.table.map(r=>r.date),['2026-01-09','2026-01-14']);assert.equal(out.table[0].values.MSFT,100);assert.ok(Math.abs(out.table[1].values.MSFT!-110)<1e-10);
});
test('conflicting duplicate prices are excluded and unequal exchange calendars cannot be forward filled',async()=>{
  const out=await executeAnalytics(priceQuery({assets:['MSFT']}),{now,prices:async s=>p(s,[['2026-01-02',100],['2026-01-02',101],['2026-01-05',110],['2026-01-06',121]])});
  assert.deepEqual(out.table.map(r=>r.date),['2026-01-05','2026-01-06']);
});
test('price FX conversion only uses same-date positive observations with attributable sources',async()=>{
  const fx=source('fx',false);
  const out=await executeAnalytics(priceQuery({assets:['MSFT'],operation:'level',currency:'EUR'}),{now,prices:async s=>p(s,[['2026-01-02',100],['2026-01-05',120]]),fx:async()=>[{date:'2026-01-02',rate:.9,source:fx}]});
  assert.equal(out.table.length,1);assert.equal(out.table[0].values.MSFT,90);assert.ok(out.sources.some(s=>s.id==='fx'));assert.equal(out.export.table,false);assert.equal(out.export.chart,true);assert.ok(out.series[0].notes.some(n=>n.includes('sin arrastrar')));
});
test('unverified FX is not accepted as a number without a source',async()=>{
  const out=await executeAnalytics(priceQuery({assets:['MSFT'],operation:'level',currency:'EUR'}),{now,prices:async s=>p(s,[['2026-01-02',100]]),fx:async()=>[{date:'2026-01-02',rate:.9}]});
  assert.equal(out.status,'unavailable');
});
test('fiscal YoY compares matching durations/currencies and preserves zero as a real numerator',async()=>{
  const data=f('MSFT',[row('2025-06-30',{revenue:100}),row('2026-06-30',{revenue:125}),row('2025-09-30',{revenue:20}),row('2026-09-30',{revenue:0})]);
  const out=await executeAnalytics(financialQuery({operation:'growth_yoy',period:{range:'custom',from:'2026-01-01',to:'2026-11-11'}}),{now,fundamentals:async()=>data});
  assert.deepEqual(out.series[0].points.map(p=>p.value),[25,-100]);
});
test('QoQ refuses to bridge a missing quarter, a zero denominator, YTD or different statement currencies',async()=>{
  const data=f('MSFT',[row('2026-03-31',{revenue:100}),row('2026-06-30',{revenue:0}),row('2026-09-30',{revenue:120}),row('2026-09-30',{revenue:999},{periodType:'YTD'})]);
  const out=await executeAnalytics(financialQuery({operation:'growth_qoq'}),{now,fundamentals:async()=>data});
  assert.equal(out.series[0].points.find(p=>p.date==='2026-06-30')!.value,-100);assert.equal(out.series[0].points.find(p=>p.date==='2026-09-30')!.value,null);
  const different=await executeAnalytics(financialQuery({operation:'growth_qoq'}),{now,fundamentals:async()=>f('MSFT',[row('2026-03-31',{revenue:100}),row('2026-09-30',{revenue:120},{currency:'EUR'})])});
  assert.ok(different.series[0].points.every(p=>p.value===null));
});
test('compatible margin ratio uses same-fiscal-period amounts and cannot borrow missing numerators',async()=>{
  const data=f('MSFT',[row('2026-03-31',{revenue:100,netIncome:15}),row('2026-06-30',{revenue:200,netIncome:null}),row('2026-09-30',{revenue:0,netIncome:5})]);
  const out=await executeAnalytics(financialQuery({metric:'netIncome',operation:'ratio',denominator:'revenue'}),{now,fundamentals:async()=>data});
  assert.deepEqual(out.series[0].points.map(p=>p.value),[15,null,null]);assert.equal(out.series[0].unit,'%');
});
test('annual periods are kept separate from quarterly or accumulated observations with identical fiscal end',async()=>{
  const out=await executeAnalytics(financialQuery({frequency:'annual'}),{now,fundamentals:async()=>f('MSFT',[row('2026-06-30',{revenue:100}),row('2026-06-30',{revenue:400},{periodType:'12M'}),row('2026-09-30',{revenue:300},{periodType:'YTD'})])});
  assert.equal(out.table.length,1);assert.equal(out.table[0].values.MSFT,400);assert.equal(out.series[0].points[0].periodType,'12M');
});
test('published future filings and a financial source for the wrong issuer are never shown',async()=>{
  const future=await executeAnalytics(financialQuery(),{now,fundamentals:async()=>f('MSFT',[row('2026-09-30',{revenue:100},{filingDate:'2026-12-01'})])});assert.equal(future.status,'unavailable');
  const wrong=await executeAnalytics(financialQuery(),{now,fundamentals:async()=>f('AAPL',[row('2026-09-30',{revenue:100})])});assert.equal(wrong.status,'unavailable');
});
test('different fiscal calendars retain actual dates rather than being renamed as one calendar quarter',async()=>{
  const out=await executeAnalytics(financialQuery({assets:['MSFT','AAPL']}),{now,fundamentals:async s=>f(s,[row(s==='MSFT'?'2026-06-30':'2026-06-27',{revenue:100})])});
  assert.deepEqual(out.table.map(r=>r.date),['2026-06-27','2026-06-30']);assert.equal(out.table[0].values.MSFT,null);assert.equal(out.table[1].values.AAPL,null);
});
test('unknown currency and changes in statement presentation never create comparable monetary levels',async()=>{
  const out=await executeAnalytics(financialQuery(),{now,fundamentals:async()=>f('MSFT',[row('2026-03-31',{revenue:100},{currency:'USD'}),row('2026-06-30',{revenue:100},{currency:'EUR'}),row('2026-09-30',{revenue:100},{currency:null})])});
  assert.equal(out.status,'unavailable');assert.ok(out.series[0].points.every(p=>p.value===null));
});
test('a period-end FX quote cannot silently translate a quarterly cash flow',async()=>{
  let called=0;const out=await executeAnalytics(financialQuery({currency:'EUR'}),{now,fundamentals:async()=>f('MSFT',[row('2026-06-30',{revenue:100})]),fx:async()=>{called++;return [{date:'2026-06-30',rate:.9,source:source('fx')}];}});
  assert.equal(called,0);assert.equal(out.status,'unavailable');assert.equal(out.alternatives[0].query.currency,'original');
});
test('CapExAI never fetches or fabricates a disclosure and offers explicitly separate totalCapEx',async()=>{
  let calls=0;const out=await executeAnalytics(financialQuery({metric:'capexAI'}),{now,fundamentals:async()=>{calls++;return f('MSFT',[row('2026-06-30',{capex:100})]);}});
  assert.equal(calls,0);assert.equal(out.status,'unavailable');assert.equal(out.series[0].points.length,0);assert.equal(out.alternatives[0].query.metric,'capex');assert.equal(out.query.metric,'capexAI');assert.ok(out.warnings[0].includes('no equivalen'));
});
test('portfolio exposure reuses current signed market values and keeps unknown values absent',async()=>{
  const out=await executeAnalytics(portfolioQuery(),{now,portfolio:async()=>({id:'11111111-1111-4111-8111-111111111111',currency:'USD',asOf:'2026-11-11T11:00:00Z',equity:1000,cash:500,positions:[{symbol:'MSFT',quantity:10,marketValue:700,currency:'USD',priceAt:'2026-11-11T11:00:00Z'},{symbol:'AAPL',quantity:-2,marketValue:-200,currency:'USD',priceAt:'2026-11-11T11:00:00Z'},{symbol:'VRT',quantity:1,marketValue:null,currency:'USD',priceAt:null}],notes:[]})});
  assert.equal(out.table[0].values.MSFT,70);assert.equal(out.table[0].values.AAPL,-20);assert.equal(out.table[0].values.VRT,null);assert.equal(out.table[0].values['portfolio-cash'],50);assert.equal(out.export.table,true);
});
test('portfolio ID guards prevent a dependency from leaking another user portfolio',async()=>{
  const q=portfolioQuery({portfolioId:'11111111-1111-4111-8111-111111111111'});
  await assert.rejects(()=>executeAnalytics(q,{now,portfolio:async()=>({id:'22222222-2222-4222-8222-222222222222',currency:'USD',asOf:new Date(now).toISOString(),equity:100,cash:100,positions:[],notes:[]})}),error=>error instanceof AnalyticsValidationError&&error.code==='forbidden');
  await assert.rejects(()=>executeAnalytics(q,{now}),error=>error instanceof AnalyticsValidationError&&error.code==='forbidden');
  assert.throws(()=>validateAnalyticsQuery(portfolioQuery({currency:'EUR'})),AnalyticsValidationError);
});
test('stock ticker CASH and portfolio cash never overwrite each other in the exported table',async()=>{
  const out=await executeAnalytics(portfolioQuery(),{now,portfolio:async()=>({id:'11111111-1111-4111-8111-111111111111',currency:'USD',asOf:new Date(now).toISOString(),equity:100,cash:60,positions:[{symbol:'CASH',quantity:1,marketValue:40,currency:'USD',priceAt:new Date(now).toISOString()}],notes:[]})});
  assert.equal(out.table[0].values.CASH,40);assert.equal(out.table[0].values['portfolio-cash'],60);
});
test('custom periods reject invalid/future dates, and no market credentials appear in the versioned query',async()=>{
  assert.throws(()=>validateAnalyticsQuery(priceQuery({period:{range:'custom',from:'2026-02-30',to:'2026-11-11'}})),AnalyticsValidationError);
  await assert.rejects(()=>executeAnalytics(priceQuery({period:{range:'custom',from:'2026-01-01',to:'2027-01-01'}}),{now}),AnalyticsValidationError);
  assert.throws(()=>validateAnalyticsQuery({...priceQuery(),apiKey:'secret'}),AnalyticsValidationError);
});
