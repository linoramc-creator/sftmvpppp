import test from 'node:test';
import assert from 'node:assert/strict';
import {executeAnalytics,validateAnalyticsQuery} from '../supabase/functions/analyze-ticker/analytics-engine.ts';
import {interpretAnalytics} from '../supabase/functions/analyze-ticker/analytics-interpret.ts';
import type {AnalyticsMetric,AnalyticsPriceInput,AnalyticsQuery} from '../supabase/functions/analyze-ticker/analytics-types.ts';
const now=Date.parse('2026-11-17T12:00:00Z'),first='2026-07-01';
const day=(index:number)=>new Date(Date.parse(first)+index*86400000).toISOString().slice(0,10);
const query=(metric:AnalyticsMetric,extra:Partial<AnalyticsQuery>={}):AnalyticsQuery=>({version:1,assets:['MSFT','SPY'],metric,operation:'level',period:{range:'custom',from:day(40),to:day(100)},frequency:'daily',currency:'USD',chart:'line',dataKind:'reported',...(['rollingCorrelation','rollingBeta','relativeStrength'].includes(metric)?{benchmark:'SPY'}:{}),...extra});
const fixture=(symbol:string,length=110):AnalyticsPriceInput=>{let price=100;const points=Array.from({length},(_,index)=>{if(index)price*=1+(symbol==='MSFT'?2:1)*(index%2?.01:-.008);return {date:day(index),value:price};});return {symbol,currency:'USD',points,adjustment:'split-adjusted-price',source:{id:'synthetic-'+symbol,name:'Synthetic unit fixture',url:'https://example.test/'+symbol,fetchedAt:new Date(now).toISOString(),dataThrough:day(length-1),exportAllowed:false,exportNote:'Test only'}};};
const loader=async(symbol:string)=>fixture(symbol);
test('price study schema canonically defaults rolling windows and rejects unrelated or unsafe parameters',()=>{
 assert.equal(validateAnalyticsQuery(query('realizedVolatility')).window,20);
 assert.equal(validateAnalyticsQuery(query('rollingBeta',{window:60})).benchmark,'SPY');
 for(const value of [query('realizedVolatility',{window:30 as 20}),query('drawdown',{window:20}),query('price',{window:20}),query('revenue',{window:20,frequency:'quarterly'}),query('rollingCorrelation',{currency:'original'}),query('rollingBeta',{benchmark:'AAPL'}),query('relativeStrength',{benchmark:undefined}),query('drawdown',{frequency:'quarterly'}),query('realizedVolatility',{operation:'base100'}),{...query('realizedVolatility'),sql:'select 1'}])assert.throws(()=>validateAnalyticsQuery(value));
});
test('realized volatility requests bounded prehistory, needs twenty returns and keeps exact samples',async()=>{
 const windows:{from:string;to:string}[]=[];const result=await executeAnalytics(query('realizedVolatility'),{now,prices:async(symbol,from,to)=>{windows.push({from,to});return fixture(symbol);}});
 assert.equal(result.query.window,20);assert.equal(windows.length,2);assert.ok(windows.every(window=>window.from<result.from&&Date.parse(result.from)-Date.parse(window.from)<=365*86400000));
 const msft=result.series[0].points[0],spy=result.series[1].points[0];assert.ok(msft.value!>0);assert.ok(Math.abs(msft.value!-2*spy.value!)<1e-10);assert.equal(msft.date,day(40));assert.equal(msft.sample?.returns,20);assert.equal(msft.sample?.observations,21);assert.equal(msft.sample?.from,day(20));assert.equal(msft.sample?.annualization,252);assert.equal(result.export.table,false);assert.ok(result.methodology.some(value=>/sin dividendos/.test(value)));
});
test('rolling beta/correlation calculate common returns and explicit self-reference without causal claims',async()=>{
 const beta=await executeAnalytics(query('rollingBeta'),{now,prices:loader}),correlation=await executeAnalytics(query('rollingCorrelation'),{now,prices:loader});
 assert.ok(beta.series[0].points.every(point=>Math.abs(point.value!-2)<1e-10));assert.ok(beta.series[1].points.every(point=>Math.abs(point.value!-1)<1e-10));assert.ok(correlation.series[0].points.every(point=>Math.abs(point.value!-1)<1e-12));assert.match(beta.series[1].label,/referencia/);assert.equal(beta.series[0].points[0].sample?.benchmark,'SPY');assert.ok(correlation.methodology.some(value=>/causalidad/.test(value)));
 assert.deepEqual(new Set(beta.series[0].sourceIds),new Set(['synthetic-MSFT','synthetic-SPY']));
});
test('zero variance is legitimate zero volatility but undefined beta and correlation remain null',async()=>{
 const flat=async(symbol:string)=>({...fixture(symbol),points:fixture(symbol).points.map(point=>({...point,value:100}))});
 const vol=await executeAnalytics(query('realizedVolatility'),{now,prices:flat});assert.equal(vol.series[0].points[0].value,0);
 for(const metric of ['rollingBeta','rollingCorrelation'] as const){const result=await executeAnalytics(query(metric),{now,prices:flat});assert.equal(result.status,'unavailable');assert.ok(result.series[0].points.every(point=>point.value===null));assert.match(result.series[0].points[0].detail!,/varianza/);}
});
test('warm-up gaps and short histories remain null rather than silently shortening the rolling window',async()=>{
 const short=await executeAnalytics(query('realizedVolatility',{period:{range:'custom',from:day(0),to:day(22)}}),{now,prices:loader});assert.ok(short.series[0].points.slice(0,20).every(point=>point.value===null));assert.ok(short.series[0].points[20].value!==null);assert.equal(short.status,'partial');
 const gapped=await executeAnalytics(query('rollingBeta',{period:{range:'custom',from:day(50),to:day(100)}}),{now,prices:async symbol=>({...fixture(symbol),points:fixture(symbol).points.filter(point=>point.date<day(20)||point.date>day(45))})});assert.equal(gapped.series[0].points[0].value,null);assert.ok(gapped.series[0].points.at(-1)!.value!==null);
});
test('missing reference and absent observed FX never become fabricated comparisons',async()=>{
 const missing=await executeAnalytics(query('relativeStrength'),{now,prices:async symbol=>symbol==='SPY'?null:fixture(symbol)});assert.equal(missing.status,'unavailable');assert.ok(missing.series[0].points.every(point=>point.value===null));assert.ok(missing.warnings.some(value=>/referencia/.test(value)));
 const fx=await executeAnalytics(query('rollingBeta'),{now,prices:async symbol=>({...fixture(symbol),currency:symbol==='SPY'?'EUR':'USD'}),fx:async()=>[]});assert.equal(fx.status,'unavailable');assert.ok(fx.series[0].points.every(point=>point.value===null));
});
test('drawdown begins at the first visible peak and cannot borrow warm-up or future highs',async()=>{
 const values=[100,90,95,120,108],result=await executeAnalytics(query('drawdown',{assets:['MSFT'],period:{range:'custom',from:day(40),to:day(44)}}),{now,prices:async symbol=>({...fixture(symbol),points:[{date:day(39),value:1000},...values.map((value,index)=>({date:day(40+index),value})),{date:day(45),value:2000}]})});
 assert.deepEqual(result.series[0].points.map(point=>Math.round(point.value!*1000)/1000),[0,-10,-5,0,-10]);assert.ok(result.methodology.some(value=>/primera observación del periodo/.test(value)));
});
test('relative strength uses a common visible base, not RSI, a difference of returns or a separate IPO rebase',async()=>{
 const result=await executeAnalytics(query('relativeStrength',{period:{range:'custom',from:day(40),to:day(41)}}),{now,prices:async symbol=>({...fixture(symbol),points:[{date:day(40),value:100},{date:day(41),value:symbol==='MSFT'?120:110}]})});
 assert.equal(result.series[0].points[0].value,0);assert.ok(Math.abs(result.series[0].points[1].value!-(1.2/1.1-1)*100)<1e-12);assert.equal(result.series[1].points[1].value,0);
});
test('weekly view samples already-computed daily study and keeps its daily return window',async()=>{
 const daily=await executeAnalytics(query('realizedVolatility'),{now,prices:loader}),weekly=await executeAnalytics(query('realizedVolatility',{frequency:'weekly'}),{now,prices:loader});
 assert.ok(weekly.series[0].points.length<daily.series[0].points.length);for(const point of weekly.series[0].points){assert.equal(point.value,daily.series[0].points.find(other=>other.date===point.date)?.value);assert.equal(point.sample?.returns,20);}
});
test('rule interpretation recognizes risk, windows and editable common-currency reference without using a model',async()=>{
 const cases:[string,string][]=[['Volatilidad realizada de Microsoft con ventana de 60 sesiones','realizedVolatility'],['Drawdown de Apple durante dos años','drawdown'],['Correlación móvil de Microsoft frente al S&P 500 de 120 sesiones','rollingCorrelation'],['Beta de Microsoft','rollingBeta'],['Fortaleza relativa de Apple frente a Microsoft','relativeStrength']];
 for(const [prompt,metric] of cases){let called=0;const result=await interpretAnalytics(prompt,'',{now,generate:async()=>{called++;return null;}});assert.equal(result.query?.metric,metric,prompt);assert.equal(result.query?.operation,'level');assert.equal(called,0,prompt);if(['rollingBeta','rollingCorrelation','relativeStrength'].includes(metric)){assert.equal(result.query?.currency,'USD');assert.ok(result.query?.benchmark);}}
 for(const prompt of ['Volatilidad implícita de Microsoft','RSI de Microsoft','Sharpe de Microsoft','Volatilidad de Microsoft de 30 sesiones']){const result=await interpretAnalytics(prompt,'',{now});assert.equal(result.query,null);assert.ok(result.alternatives?.length);}
 const multiple=await interpretAnalytics('Volatilidad y drawdown de Microsoft durante un año','',{now});assert.equal(multiple.query,null);assert.deepEqual(multiple.alternatives?.map(item=>item.query.metric),['realizedVolatility','drawdown']);assert.ok(multiple.alternatives?.every(item=>item.query.period.range==='1y'));
 const unfamiliar=await interpretAnalytics('Volatilidad realizada de Iberdrola ventana 60 en EUR','',{now,generate:async()=>({query:query('realizedVolatility',{assets:['IBE.MC'],window:20,currency:'USD'})})});assert.equal(unfamiliar.query?.window,60);assert.equal(unfamiliar.query?.currency,'EUR');
});
