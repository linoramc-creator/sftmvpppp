import test from 'node:test';
import assert from 'node:assert/strict';
import {executeMensorLab,validateLabDefinition} from '../supabase/functions/analyze-ticker/mensorlab-engine.ts';
import type {LabDefinition,LabStudy} from '../supabase/functions/analyze-ticker/mensorlab-types.ts';
import type {AnalyticsPriceInput,AnalyticsQuery} from '../supabase/functions/analyze-ticker/analytics-types.ts';

const now=Date.parse('2026-11-16T10:00:00Z');
const query:AnalyticsQuery={version:1,assets:['MSFT','SPY'],metric:'price',operation:'base100',period:{range:'1y'},frequency:'daily',currency:'USD',chart:'line',dataKind:'reported'};
const comparison:LabStudy={id:'comparison',name:'Comparación',kind:'comparison',query,benchmark:'SPY'};
const definition:LabDefinition={version:1,studies:[comparison]};
const prices=(symbol:string,length=35):AnalyticsPriceInput=>{
 let value=100;const points=Array.from({length},(_,i)=>{if(i)value*=1+(symbol==='MSFT'?2:1)*(i%2?0.01:-0.008);return {date:new Date(Date.parse('2026-10-01')+i*86400000).toISOString().slice(0,10),value};});
 return {symbol,currency:'USD',adjustment:'split-adjusted-price',points,source:{id:'fixture-'+symbol,name:'Synthetic unit fixture',url:'https://example.test/'+symbol,fetchedAt:new Date(now).toISOString(),dataThrough:points.at(-1)!.date,exportAllowed:false,exportNote:'Unit-test only'}};
};
test('MensorLab rejects hidden operations, expressions, invalid weights and portfolio writes',()=>{
 assert.deepEqual(validateLabDefinition(definition),definition);
 for(const bad of [{...definition,sql:'select 1'},{version:1,studies:[]},{version:1,studies:[comparison,comparison]},{version:1,studies:[{...comparison,query:{...query,currency:'original'}}]},{version:1,studies:[{...comparison,benchmark:'AAPL'}]},{version:1,studies:[{...comparison,query:{...query,metric:'portfolioExposure',assets:[],operation:'level',chart:'bar',currency:'original'}}]},{version:1,studies:[{...comparison,kind:'scenario',weights:[{symbol:'MSFT',weight:60}],cashWeight:30}]},{version:1,studies:[{...comparison,kind:'scenario',weights:[{symbol:'MSFT',weight:-10},{symbol:'SPY',weight:110}],cashWeight:0}]},{version:1,studies:[{...comparison,kind:'analytics',weights:[]}]}])assert.throws(()=>validateLabDefinition(bad));
});
test('server computes matched price metrics and reuses asset-window data once across studies',async()=>{
 const calls:string[]=[];
 const run=await executeMensorLab({version:1,studies:[comparison,{...comparison,id:'risk-again',name:'Otra vista'}]},{now,prices:async symbol=>{calls.push(symbol);return prices(symbol);}});
 assert.deepEqual(calls,['MSFT','SPY']);assert.equal(run.results.length,2);
 const result=run.results[0],msft=result.metrics[0],spy=result.metrics[1];
 assert.equal(msft.observations,35);assert.equal(msft.returns,34);assert.ok(Math.abs(msft.beta!-2)<1e-10);assert.ok(Math.abs(msft.correlation!-1)<1e-12);assert.equal(spy.relativeStrength,0);assert.ok(msft.drawdown!<0);assert.ok(msft.volatility!>spy.volatility!);assert.ok(msft.relativeStrength!>0);
 assert.equal(result.correlations.values[0][0],1);assert.equal(result.sample.minimumRiskReturns,20);assert.equal(result.sample.annualization,252);assert.equal(result.analytics.export.table,false);assert.ok(result.warnings.some(v=>/siete días/.test(v)));
 assert.equal(result.analytics.sources[0].name,'Synthetic unit fixture');
});
test('risk unknown for short sample, zero variance and missing reference; no fabricated zeros',async()=>{
 const run=await executeMensorLab(definition,{now,prices:async symbol=>symbol==='SPY'?null:prices(symbol,10)});
 const result=run.results[0];assert.equal(result.metrics[0].volatility,null);assert.equal(result.metrics[0].beta,null);assert.equal(result.metrics[1].priceChange,null);assert.equal(result.correlations.values[0][0],null);assert.ok(result.metrics[0].priceChange!==null);
 const flat=await executeMensorLab(definition,{now,prices:async symbol=>({...prices(symbol),points:prices(symbol).points.map(p=>({...p,value:100}))})});
 assert.equal(flat.results[0].metrics[0].volatility,0);assert.equal(flat.results[0].metrics[0].beta,null);assert.equal(flat.results[0].metrics[0].correlation,null);
});
test('partial dates align without forward fills and mixed currencies require observed FX',async()=>{
 const run=await executeMensorLab(definition,{now,prices:async symbol=>{const data=prices(symbol);if(symbol==='SPY')data.points.splice(10,2);return data;}});
 assert.equal(run.results[0].sample.observations,33);assert.equal(run.results[0].metrics[0].observations,33);
 const noFX=await executeMensorLab(definition,{now,prices:async symbol=>({...prices(symbol),currency:symbol==='SPY'?'EUR':'USD'}),fx:async()=>[]});
 assert.equal(noFX.results[0].metrics[1].priceChange,null);assert.ok(noFX.results[0].warnings.some(note=>/parcial/.test(note)));
});
test('positive unknown scenario exposure blocks aggregate risk without renormalizing the rest',async()=>{
 const study:LabStudy={...comparison,kind:'scenario',weights:[{symbol:'MSFT',weight:50},{symbol:'SPY',weight:40}],cashWeight:10};
 const run=await executeMensorLab({version:1,studies:[study]},{now,prices:async symbol=>symbol==='SPY'?null:prices(symbol)});
 const scenario=run.results[0].scenario!;
 assert.equal(scenario.coveredWeight,60);assert.equal(scenario.annualizedVolatility,null);assert.equal(scenario.concentration,4200);assert.equal(scenario.largestWeight,50);assert.equal(scenario.weights[0].weight,50);assert.equal(scenario.status,'unavailable');assert.ok(scenario.notes.some(note=>/sin renormalizar/.test(note)));
});
test('scenario covariance uses explicit cash with zero assumed return and never accesses trading',async()=>{
 const study:LabStudy={...comparison,kind:'scenario',weights:[{symbol:'MSFT',weight:50}],cashWeight:50};
 const run=await executeMensorLab({version:1,studies:[study]},{now,prices:async symbol=>prices(symbol)}),result=run.results[0],scenario=result.scenario!;
 assert.ok(Math.abs(scenario.annualizedVolatility!-result.metrics[0].volatility!/2)<1e-10);assert.equal(scenario.concentration,5000);assert.equal(scenario.effectiveHoldings,2);assert.equal(scenario.cashWeight,50);assert.ok(scenario.notes.some(note=>/no consulta ni modifica/.test(note)));assert.ok(scenario.notes.some(note=>/sin interés/.test(note)));
 assert.equal(JSON.stringify(run).includes('quantity'),false);
});
test('diversification estimate uses off-diagonal covariance, not weighted standalone risk',async()=>{
 const study:LabStudy={...comparison,kind:'scenario',weights:[{symbol:'MSFT',weight:50},{symbol:'SPY',weight:50}],cashWeight:0};
 const run=await executeMensorLab({version:1,studies:[study]},{now,prices:async symbol=>{let level=100;return {...prices(symbol),points:prices(symbol).points.map((p,i)=>{if(i)level*=1+(symbol==='MSFT'?1:-1)*(i%2?0.01:-0.008);return {...p,value:level};})};}});
 const scenario=run.results[0].scenario!;assert.ok(scenario.annualizedVolatility!<0.000001);assert.ok(scenario.diversificationBenefit!>5);assert.ok(run.results[0].correlations.values[0][1]!<-0.999999);
});
test('future dates in later studies are rejected before any provider work',async()=>{
 let calls=0;await assert.rejects(executeMensorLab({version:1,studies:[comparison,{...comparison,id:'future',query:{...query,period:{range:'custom',from:'2026-11-15',to:'2026-12-15'}}}]},{now,prices:async()=>{calls++;return null;}}));assert.equal(calls,0);
});
test('existing Analytics fundamental definitions wrap exact results without forcing price metrics',async()=>{
 const run=await executeMensorLab({version:1,studies:[{id:'legacy',name:'Ingresos',kind:'analytics',query:{...query,metric:'revenue',operation:'level',frequency:'quarterly',chart:'bar'}}]},{now,fundamentals:async()=>null});
 assert.equal(run.status,'unavailable');assert.equal(run.results[0].analytics.query.metric,'revenue');assert.deepEqual(run.results[0].metrics,[]);assert.equal(run.results[0].analytics.series[0].points.length,0);
 assert.equal(run.results[0].analytics.alternatives[0].query.metric,'price');assert.match(run.results[0].analytics.alternatives[0].reason,/diferente/);
});
