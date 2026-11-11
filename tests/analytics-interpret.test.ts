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
  for(const prompt of ['Compara la rentabilidad total de MSFT y AAPL','Grafica las previsiones de ingresos de Microsoft','Grafica Microsoft con dividendos reinvertidos'])await assert.rejects(()=>interpretAnalytics(prompt,'',{now}),e=>e instanceof AnalyticsValidationError&&e.code==='unsupported');
});
test('PER, EBITDA ratios and unrecognized ratio requests do not fall back to price or debtlevel',async()=>{
  for(const prompt of ['Compara PER de MSFT y AAPL','Ratio deuda/EBITDA de Microsoft','Ratio de Microsoft y Apple'])await assert.rejects(()=>interpretAnalytics(prompt,'',{now}),e=>e instanceof AnalyticsValidationError&&e.code==='unsupported');
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
  await assert.rejects(()=>interpretAnalytics('Research especial de Iberdrola','',{now,generate:async()=>({unsupported:true,reason:'No data'})}),e=>e instanceof AnalyticsValidationError&&e.code==='unsupported');
  await assert.rejects(()=>interpretAnalytics('Research especial de Iberdrola','',{now,generate:async()=>{throw new Error('provider secret');}}),e=>e instanceof AnalyticsValidationError&&!e.message.includes('secret'));
});
test('arbitrary code, URLs, leaked credential input and oversized prompts never reach an interpreter',async()=>{
  let calls=0;for(const prompt of ['select * from users','api_key=secret MSFT','https://evil.example/secret MSFT','x'.repeat(1700)])await assert.rejects(()=>interpretAnalytics(prompt,'',{now,generate:async()=>{calls++;return null;}}),AnalyticsValidationError);assert.equal(calls,0);
});
