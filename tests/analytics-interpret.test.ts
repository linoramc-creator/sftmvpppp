import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretAnalytics,ANALYTICS_BIG7} from '../supabase/functions/analyze-ticker/analytics-interpret.ts';
import {AnalyticsValidationError} from '../supabase/functions/analyze-ticker/analytics-engine.ts';
const now=Date.parse('2026-11-11T12:00:00Z');

test('Microsoft and S&P500 two-year example produces reproducible allowlisted price query with visible defaults',async()=>{
  let calls=0;const out=await interpretAnalytics('Compara Microsoft y el S&P 500 los últimos dos años','',{now,generate:async()=>{calls++;return null;}});
  assert.equal(calls,0);assert.deepEqual(out.query.assets,['MSFT','^GSPC']);assert.equal(out.query.metric,'price');assert.equal(out.query.operation,'base100');assert.equal(out.query.period.range,'2y');assert.equal(out.query.chart,'line');assert.ok(out.defaults.some(x=>x.includes('sin reinvertir dividendos')));
});
test('quarterly Big7 revenue growth uses seven issuers, one Alphabet class and explicitly disclosed YoY default',async()=>{
  const out=await interpretAnalytics('Grafica el crecimiento trimestral de ingresos de las Big 7','',{now});
  assert.deepEqual(out.query.assets,ANALYTICS_BIG7);assert.equal(out.query.metric,'revenue');assert.equal(out.query.frequency,'quarterly');assert.equal(out.query.operation,'growth_yoy');assert.ok(out.defaults.some(n=>n.includes('interanual')));
  const duplicate=await interpretAnalytics('Compara Google, GOOG, GOOGL y Apple','',{now});assert.deepEqual(duplicate.query.assets,['AAPL','GOOGL']);
});
test('AI CapEx example remains specific unsupported disclosure instead of silently becoming totalCapEx',async()=>{
  const out=await interpretAnalytics('Evolución del CapEx en IA de las Big 7 durante dos años','',{now});
  assert.equal(out.query.metric,'capexAI');assert.equal(out.query.period.range,'2y');assert.ok(out.notices.some(n=>n.includes('por separado')));
});
test('synonyms support English MagnificentSeven, Spanish siete magníficas and explicit quarterly growth basis',async()=>{
  for(const name of ['Magnificent Seven','las siete magníficas','Mag 7']){
    const out=await interpretAnalytics('Grafica revenue growth YoY de '+name,'',{now});assert.deepEqual(out.query.assets,ANALYTICS_BIG7);assert.equal(out.query.operation,'growth_yoy');
  }
  const qoq=await interpretAnalytics('Crecimiento intertrimestral de ingresos de Microsoft','',{now});assert.equal(qoq.query.operation,'growth_qoq');
});
test('declared forecast and total return requests cannot be silently replaced by reported data or price',async()=>{
  for(const prompt of ['Compara la rentabilidad total de MSFT y AAPL','Grafica las previsiones de ingresos de Microsoft','Grafica Microsoft con dividendos reinvertidos']){const out=await interpretAnalytics(prompt,'',{now});assert.equal(out.query,null);assert.equal(out.status,'unsupported');assert.ok(out.alternatives?.length);assert.ok(out.notices.some(note=>note.includes('No se ha sustituido')));}
});
test('PER, EBITDA ratios and unrecognized ratio requests do not fall back to price or debtlevel',async()=>{
  for(const prompt of ['Histórico del PER de MSFT y AAPL','Ratio deuda/EBITDA de Microsoft','Ratio de Microsoft y Apple']){const out=await interpretAnalytics(prompt,'',{now});assert.equal(out.query,null);assert.equal(out.status,'unsupported');assert.ok(out.alternatives?.length);assert.ok(out.alternatives?.every(idea=>idea.query.metric!=='price'));}
});
test('explicit three-year/six-month periods are honored as fixed editable dates, never replaced by2years',async()=>{
  const a=await interpretAnalytics('Compara Microsoft y Apple los últimos tres años','',{now});assert.deepEqual(a.query.period,{range:'custom',from:'2023-11-11',to:'2026-11-11'});
  const b=await interpretAnalytics('Evolución de Microsoft durante 6 meses','',{now});assert.deepEqual(b.query.period,{range:'custom',from:'2026-05-11',to:'2026-11-11'});
});
test('compatible margins translate into compatible ratios and annual growth remains separate',async()=>{
  const a=await interpretAnalytics('Muestra el margen neto de Microsoft','',{now});assert.equal(a.query.metric,'netIncome');assert.equal(a.query.operation,'ratio');assert.equal(a.query.denominator,'revenue');
  const b=await interpretAnalytics('Ratio deuda sobre patrimonio de Microsoft','',{now});assert.equal(b.query.denominator,'equity');
  const c=await interpretAnalytics('Grafica ingresos anuales de Apple','',{now});assert.equal(c.query.frequency,'annual');
});
test('portfolio exposure request has no manufactured portfolio id or duplicate holdings definition',async()=>{
  const out=await interpretAnalytics('Distribución y pesos de mi portfolio','',{now});assert.equal(out.query.metric,'portfolioExposure');assert.deepEqual(out.query.assets,[]);assert.equal(out.query.portfolioId,undefined);assert.equal(out.query.chart,'bar');
});
test('model interpretation is schema validated, contains no prices and rejects injected execution privileges',async()=>{
  const valid={version:1,assets:['IBE.MC'],metric:'revenue',operation:'level',period:{range:'2y'},frequency:'quarterly',currency:'original',chart:'bar',dataKind:'reported'};
  const output=await interpretAnalytics('Ingresos de Iberdrola','fake-not-used',{now,generate:async prompt=>{assert.ok(prompt.includes('no fiables'));return {query:valid,defaults:['Frecuencia trimestral'],notices:[]};}});
  assert.equal(output.interpretedBy,'model');assert.deepEqual(output.query.assets,['IBE.MC']);
  await assert.rejects(()=>interpretAnalytics('Ingresos de Iberdrola','',{now,generate:async()=>({query:{...valid,sql:'select *'}})}),AnalyticsValidationError);
  await assert.rejects(()=>interpretAnalytics('Ingresos de Iberdrola','',{now,generate:async()=>({query:{...valid,assets:['../secret']}})}),AnalyticsValidationError);
});
test('a mixed known/unknown company name is interpreted without silently dropping the unfamiliar issuer',async()=>{
  let calls=0;const out=await interpretAnalytics('Compara Microsoft e Iberdrola','',{now,generate:async()=>{calls++;return {query:{version:1,assets:['MSFT','IBE.MC'],metric:'price',operation:'base100',period:{range:'2y'},frequency:'daily',currency:'original',chart:'line',dataKind:'reported'},defaults:[],notices:[]};}});
  assert.equal(calls,1);assert.deepEqual(out.query.assets,['MSFT','IBE.MC']);
});
test('unsupported or failed model output leaves controls usable and never generates a substitute metric',async()=>{
  const unsupported=await interpretAnalytics('Research especial de Iberdrola','',{now,generate:async()=>({unsupported:true,reason:'No data'})});assert.equal(unsupported.query,null);assert.equal(unsupported.status,'unsupported');assert.ok(unsupported.alternatives?.length);
  const failure=await interpretAnalytics('Research especial de Iberdrola','',{now,generate:async()=>{throw new Error('provider secret');}});assert.equal(failure.query,null);assert.equal(failure.status,'unavailable');assert.ok(!JSON.stringify(failure).includes('secret'));assert.ok(failure.alternatives?.length);
});
test('arbitrary code, URLs, leaked credential input and oversized prompts never reach an interpreter',async()=>{
  let calls=0;for(const prompt of ['select * from users','api_key=secret MSFT','https://evil.example/secret MSFT','x'.repeat(1700)])await assert.rejects(()=>interpretAnalytics(prompt,'',{now,generate:async()=>{calls++;return null;}}),AnalyticsValidationError);assert.equal(calls,0);
});
test('historical PER keeps assets while current alternatives are distinctly dated and the fiscal alternative retains the period',async()=>{
 const out=await interpretAnalytics('Compara PER de Microsoft y Google durante tres años en EUR','',{now});assert.equal(out.query,null);assert.deepEqual(out.alternatives?.[0].query.assets,['MSFT','GOOGL']);assert.equal(out.alternatives?.[0].query.metric,'forwardPeCurrent');assert.equal(out.alternatives?.[0].query.period.range,'1y');assert.match(out.alternatives?.[0].reason??'',/actual/);const fiscal=out.alternatives?.find(idea=>idea.query.metric==='freeCashFlow')!;assert.equal(fiscal.query.denominator,'revenue');assert.deepEqual(fiscal.query.period,{range:'custom',from:'2023-11-11',to:'2026-11-11'});assert.equal(fiscal.query.currency,'EUR');
});

test('unsupported candlestick does not silently become a line and missing symbols are disclosed with independent themes',async()=>{
 const candle=await interpretAnalytics('Velas japonesas de Microsoft','',{now});assert.equal(candle.query,null);assert.equal(candle.status,'unsupported');assert.ok(candle.alternatives?.[0].query.chart==='line');
 const missing=await interpretAnalytics('Compara el PER durante dos años','',{now});assert.equal(missing.query,null);assert.ok(missing.alternatives?.every(idea=>idea.reason.includes('No se identificaron')));assert.ok(missing.alternatives?.every(idea=>!idea.query.assets.includes('PER')));
});
test('valuation abbreviations never become phantom asset classes in alternatives',async()=>{
 const out=await interpretAnalytics('Grafica P/E de Microsoft y Apple','',{now});assert.equal(out.query?.metric,'trailingPeCurrent');assert.deepEqual(out.query?.assets,['AAPL','MSFT']);
});
test('period limit alternatives preserve price assets and metrics instead of offering fundamentals for an index',async()=>{
 for(const period of ['20 años','200 meses']){const out=await interpretAnalytics('Compara Microsoft y S&P 500 los últimos '+period+' en EUR','',{now});assert.equal(out.query,null);assert.equal(out.status,'unsupported');assert.equal(out.alternatives?.length,1);const alternative=out.alternatives![0];assert.deepEqual(alternative.query.assets,['MSFT','^GSPC']);assert.equal(alternative.query.metric,'price');assert.equal(alternative.query.operation,'base100');assert.equal(alternative.query.period.range,'5y');assert.equal(alternative.query.currency,'EUR');assert.match(alternative.reason,/periodo más corto/);}
 const fundamental=await interpretAnalytics('Crecimiento trimestral de ingresos de las Big 7 durante 20 años','',{now});assert.equal(fundamental.query,null);assert.equal(fundamental.alternatives?.[0].query.metric,'revenue');assert.equal(fundamental.alternatives?.[0].query.operation,'growth_yoy');assert.equal(fundamental.alternatives?.[0].query.frequency,'quarterly');
});
test('model cannot silently change AI CapEx or another explicitly requested metric for an unfamiliar company',async()=>{
 const query={version:1,assets:['IBE.MC'],metric:'capex',operation:'level',period:{range:'2y'},frequency:'quarterly',currency:'original',chart:'line',dataKind:'reported'};
 const capex=await interpretAnalytics('Evolución del CapEx en IA de Iberdrola','',{now,generate:async()=>({query})});assert.equal(capex.query,null);assert.equal(capex.status,'unsupported');assert.equal(capex.alternatives?.[0].query.metric,'capex');assert.match(capex.alternatives?.[0].reason??'',/incluye inversión ajena a IA/);assert.match(capex.alternatives?.[0].label??'',/por separado/);
 const revenue=await interpretAnalytics('Ingresos de Iberdrola','',{now,generate:async()=>({query:{...query,metric:'netIncome'}})});assert.equal(revenue.query,null);assert.equal(revenue.alternatives?.[0].query.metric,'revenue');assert.deepEqual(revenue.alternatives?.[0].query.assets,['IBE.MC']);
 const validRatio=await interpretAnalytics('Caja sobre deuda de Iberdrola','',{now,generate:async()=>({query:{...query,metric:'cash',operation:'ratio',denominator:'totalDebt'}})});assert.equal(validRatio.query?.metric,'cash');assert.equal(validRatio.query?.denominator,'totalDebt');
});
