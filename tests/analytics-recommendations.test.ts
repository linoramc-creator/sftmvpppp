import test from 'node:test';
import assert from 'node:assert/strict';
import {analyticsIdeas,analyticsAlternativeSuggestions,analyticsResultAlternatives,analyticsSuggestionCoverage,validateAnalyticsIdeasContext} from '../supabase/functions/analyze-ticker/analytics-recommendations.ts';
import {executeAnalytics,validateAnalyticsQuery,AnalyticsValidationError,ANALYTICS_PRICE_STUDIES} from '../supabase/functions/analyze-ticker/analytics-engine.ts';

const now=Date.parse('2026-11-16T12:00:00Z');
test('curated research ideas are executable catalog definitions, not claims of observed popularity or forecasts',()=>{
 const ideas=analyticsIdeas();assert.ok(ideas.length>=5);assert.equal(new Set(ideas.map(idea=>idea.id)).size,ideas.length);
 for(const idea of ideas){assert.deepEqual(validateAnalyticsQuery(idea.query),idea.query);assert.equal(idea.coverage.status,'catalog');assert.equal(idea.kind,'theme');assert.match(idea.coverage.notice??'',/verifica al abrirla/);assert.ok(!/mas populares|más populares|flujos institucionales|en tiempo real/i.test(idea.reason));}
 const ai=ideas.find(idea=>idea.id==='theme-ai-capex')!;assert.equal(ai.query.metric,'capex');assert.equal(ai.query.assets.length,7);assert.ok(!ai.query.assets.includes('GOOG'));assert.match(ai.reason,/No es un desglose/);
});
test('company contexts preserve actual ticker and unknown ETF/FX/index types do not receive corporate fundamentals',()=>{
 const company=analyticsIdeas({symbol:'GOOG',kind:'stock'});assert.ok(company.every(idea=>idea.query.assets.includes('GOOGL')));assert.ok(company.some(idea=>idea.query.metric==='revenue'));
 for(const context of [{symbol:'QQQ',kind:'etf'},{symbol:'^IBEX',kind:'index'},{symbol:'EURUSD=X',kind:'forex'}] as const){const ideas=analyticsIdeas(context);assert.ok(ideas.length>=2);assert.ok(ideas.every(idea=>idea.query.metric==='price'||ANALYTICS_PRICE_STUDIES.has(idea.query.metric)));assert.ok(ideas.every(idea=>idea.query.assets.includes(context.symbol)));}
 const fx=analyticsIdeas({symbol:'EURUSD=X',kind:'forex'})[0];assert.deepEqual(fx.query.assets,['EURUSD=X','GBPUSD=X']);
});
test('sector proposals use labelled representative ETFs and never manufacture an unknown sector symbol',()=>{
 const semis=analyticsIdeas({kind:'sector',sector:'Semiconductores'});assert.deepEqual(semis[0].query.assets,['SOXX','^GSPC']);assert.match(semis[0].reason,/representante negociable/);assert.match(semis[0].reason,/no es el índice/);
 const unknown=analyticsIdeas({kind:'sector',sector:'Robótica cuántica experimental'});assert.deepEqual(unknown[0].query.assets,['SPY','^GSPC']);assert.match(unknown[0].reason,/mercado estadounidense/);
});
test('spot oil context never invents a historic spot series or disguises a future as the physical price',()=>{
 for(const symbol of ['WTI-SPOT','BRENT-SPOT']){const ideas=analyticsIdeas({symbol,kind:'commodity'});assert.ok(ideas.length);assert.match(ideas[0].reason,/No es la serie física/);assert.deepEqual(ideas[0].query.assets,['XLE','^GSPC']);assert.ok(!JSON.stringify(ideas).includes('CL=F'));}
});
test('context boundary rejects untrusted extra fields, invalid symbols and source URLs while accepting existing market kind aliases',()=>{
 assert.deepEqual(validateAnalyticsIdeasContext({symbol:'QQQ',kind:'ETF'}),{symbol:'QQQ',kind:'etf'});assert.deepEqual(validateAnalyticsIdeasContext({symbol:'GOOG',kind:'equity'}),{symbol:'GOOGL',kind:'stock'});
 for(const value of [{symbol:'../secret'},{symbol:'MSFT',sql:'select'},{sector:'https://evil.test/data'},{kind:'sql'},{symbol:'AAPL',ownerId:'other'},null])assert.throws(()=>validateAnalyticsIdeasContext(value),AnalyticsValidationError);
});
test('related alternatives retain requested assets, dates and currency, and do not impersonate the unavailable ratio',()=>{
 const ideas=analyticsAlternativeSuggestions({prompt:'PER MSFT AAPL últimos 5 años en USD',assets:['MSFT','AAPL'],category:'valuation',now});
 assert.ok(ideas.length);for(const idea of ideas){assert.deepEqual(idea.query.assets,['MSFT','AAPL']);assert.equal(idea.query.period.range,'5y');assert.equal(idea.query.currency,'USD');assert.equal(idea.query.operation,'ratio');assert.equal(idea.kind,'alternative');assert.ok(!idea.label.includes('PER'));assert.match(idea.reason,/no sustituye|No es un múltiplo/);validateAnalyticsQuery(idea.query);}
 const total=analyticsAlternativeSuggestions({prompt:'rentabilidad total MSFT',assets:['MSFT'],category:'total-return',now});assert.match(total[0].reason,/no equivale/);assert.equal(total[0].query.operation,'base100');
});
test('missing fundamental data offers an explicit price alternative without changing the original result',async()=>{
 const idea=analyticsIdeas({symbol:'VRT',kind:'stock'}).find(idea=>idea.query.metric==='revenue')!,result=await executeAnalytics(idea.query,{now,fundamentals:async()=>null});
 assert.equal(result.status,'unavailable');const alternatives=analyticsResultAlternatives(result);assert.equal(result.query.metric,'revenue');assert.equal(alternatives[0].query.metric,'price');assert.match(alternatives[0].reason,/consulta de precios diferente/);assert.equal(result.series[0].points.length,0);
});
test('coverage stamps only exact checked definitions and explicitly lists missing assets',async()=>{
 const idea=analyticsIdeas({symbol:'MSFT',kind:'stock'})[0],result=await executeAnalytics(idea.query,{now,prices:async symbol=>symbol==='MSFT'?{symbol,currency:'USD',points:[{date:'2026-11-12',value:100},{date:'2026-11-13',value:101}],adjustment:'split-adjusted-price',source:{id:'test:MSFT',name:'Test data',url:'https://example.test/prices',fetchedAt:new Date(now).toISOString(),dataThrough:'2026-11-13',exportAllowed:false,exportNote:'Test'}}:null});
 const checked=analyticsSuggestionCoverage(idea,result);assert.equal(checked.coverage.status,'partial');assert.deepEqual(checked.coverage.availableAssets,['MSFT']);assert.deepEqual(checked.coverage.missingAssets,['^GSPC']);assert.equal(checked.coverage.checkedAt,result.generatedAt);
 const other=analyticsIdeas({symbol:'AAPL',kind:'stock'})[0];assert.equal(analyticsSuggestionCoverage(other,result).coverage.status,'catalog');
});
