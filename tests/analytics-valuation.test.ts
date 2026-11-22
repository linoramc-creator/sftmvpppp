import test from 'node:test';
import assert from 'node:assert/strict';
import {analyticsValuationFromSummary} from '../supabase/functions/analyze-ticker/analytics-valuation.ts';
import {executeAnalytics,validateAnalyticsQuery} from '../supabase/functions/analyze-ticker/analytics-engine.ts';
import {interpretAnalytics} from '../supabase/functions/analyze-ticker/analytics-interpret.ts';
import {analyticsFundamentalsFromSec,analyticsFundamentalsFromTimeseries,analyticsFundamentalsFromEodhd} from '../supabase/functions/analyze-ticker/analytics-providers.ts';
import {executeMensorLab} from '../supabase/functions/analyze-ticker/mensorlab-engine.ts';
import type {AnalyticsQuery,AnalyticsSource,AnalyticsFundamentalInput} from '../supabase/functions/analyze-ticker/analytics-types.ts';

const now=Date.parse('2026-11-22T12:00:00Z'),quoteAt=Date.parse('2026-11-20T21:00:00Z');
const summary=()=>({quoteType:{symbol:'MSFT',quoteType:'EQUITY'},price:{currency:'USD',regularMarketTime:quoteAt/1000},summaryDetail:{forwardPE:{raw:25},trailingPE:{raw:30}},defaultKeyStatistics:{priceToBook:12,enterpriseToEbitda:22,trailingEps:10}});
const query=(extra:Partial<AnalyticsQuery>={}):AnalyticsQuery=>({version:1,assets:['MSFT','AAPL'],metric:'forwardPeCurrent',operation:'level',frequency:'daily',chart:'bar',currency:'original',dataKind:'estimate',period:{range:'2y'},...extra});
const source=(id:string,exportAllowed=true):AnalyticsSource=>({id,name:'Fixture '+id,url:'https://example.test/financials',fetchedAt:new Date(now).toISOString(),dataThrough:'2026-09-30',exportAllowed,exportNote:'Fixture, no real data.'});
const fund=(rows:AnalyticsFundamentalInput['rows']):AnalyticsFundamentalInput=>({symbol:'MSFT',rows,source:source('sec'),sources:[source('other',false)]});
const financial=(extra:Partial<AnalyticsQuery>={}):AnalyticsQuery=>query({assets:['MSFT'],metric:'operatingIncome',frequency:'quarterly',dataKind:'reported',...extra});

test('current valuation parser verifies issuer, equity type, source identity and latest quote; ratios are not forecasts disguised as realized data',()=>{
 const result=analyticsValuationFromSummary('MSFT',summary(),now)!;assert.equal(result.values.forwardPeCurrent,25);assert.equal(result.quoteAt,new Date(quoteAt).toISOString());assert.equal(result.asOf,new Date(now).toISOString());assert.equal(result.source.exportAllowed,false);assert.match(result.notes.join(' '),/horizonte exacto/);
 for(const raw of [{...summary(),quoteType:{symbol:'AAPL',quoteType:'EQUITY'}},{...summary(),quoteType:{symbol:'MSFT',quoteType:'ETF'}},{...summary(),eodhd:{provider:'eodhd'}},{...summary(),price:{regularMarketTime:(now-8*86400000)/1000}},{...summary(),price:{regularMarketTime:now/1000+1}},{...summary(),price:{regularMarketTime:Number.MAX_VALUE}}])assert.equal(analyticsValuationFromSummary('MSFT',raw,now),null);
 const negative=summary();negative.defaultKeyStatistics.trailingEps=-1;assert.equal(analyticsValuationFromSummary('MSFT',negative,now)!.values.trailingPeCurrent,null);
});

test('snapshot metric validation disallows historical frequencies, extra forecasts, growth and model code',()=>{
 assert.equal(validateAnalyticsQuery(query()).dataKind,'estimate');
 for(const extra of [{dataKind:'reported'},{frequency:'monthly'},{operation:'growth_yoy'},{chart:'line'},{metric:'forwardPeHistory'},{metric:'revenue',dataKind:'estimate',frequency:'quarterly'},{window:20},{sql:'select secrets'}])assert.throws(()=>validateAnalyticsQuery({...query(),...extra}));
 assert.equal(validateAnalyticsQuery(query({metric:'trailingPeCurrent',dataKind:'reported'})).metric,'trailingPeCurrent');
});

test('a five-year valuation request returns at most a current observation, no price calls, with null uncovered companies and licensed exports',async()=>{
 let prices=0,financials=0,calls=0;
 const result=await executeAnalytics(query({period:{range:'5y'}}),{now,valuation:async symbol=>{calls++;return symbol==='MSFT'?analyticsValuationFromSummary(symbol,summary(),now):null;},prices:async()=>{prices++;throw Error();},fundamentals:async()=>{financials++;throw Error();}});
 assert.equal(calls,2);assert.equal(prices,0);assert.equal(financials,0);assert.equal(result.status,'partial');assert.equal(result.table.length,1);assert.equal(result.table[0].date,'2026-11-22');assert.equal(result.table[0].values.MSFT,25);assert.equal(result.table[0].values.AAPL,null);assert.equal(result.series[0].unit,'x');assert.equal(result.series[0].currency,null);assert.equal(result.export.table,false);assert.equal(result.export.chart,true);assert.match(result.methodology.join(' '),/no se copia sobre precios antiguos/);
});

test('historical custom dates cannot be ignored to display a current valuation snapshot',async()=>{
 const result=await executeAnalytics(query({assets:['MSFT'],period:{range:'custom',from:'2025-01-01',to:'2025-12-31'}}),{now,valuation:async symbol=>analyticsValuationFromSummary(symbol,summary(),now)});
 assert.equal(result.status,'unavailable');assert.equal(result.table.length,0);assert.equal(result.export.chart,false);assert.equal(result.alternatives.length,1);assert.equal(result.query.period.to,'2025-12-31');assert.equal(result.alternatives[0].query.period.range,'1y');
});

test('historical forward PE and TTM requests keep original intent unsupported, with explicit separately executable current alternatives and no AI',async()=>{
 let modelCalls=0;
 for(const prompt of ['Evolución del forward P/E de Microsoft durante dos años','Histórico del PER forward de las Big 7','Grafica el PER TTM de Microsoft los últimos 5 años']){
  const result=await interpretAnalytics(prompt,'',{now,generate:async()=>{modelCalls++;throw Error();}});
  assert.equal(result.query,null);assert.equal(result.status,'unsupported');assert.match(result.notices.join(' '),/point-in-time/);assert.equal(result.alternatives![0].query.metric,'forwardPeCurrent');assert.equal(result.alternatives![0].query.dataKind,'estimate');assert.equal(result.alternatives![1].query.metric,'trailingPeCurrent');assert.match(result.alternatives![0].reason,/No reproduce/);
 }
 assert.equal(modelCalls,0);
 const current=await interpretAnalytics('Compara el PER forward actual de Microsoft y Apple','',{now});assert.equal(current.query?.metric,'forwardPeCurrent');assert.equal(current.query?.chart,'bar');assert.equal(current.query?.dataKind,'estimate');assert.deepEqual(current.query?.assets,['AAPL','MSFT']);
 const ntm=await interpretAnalytics('PER forward NTM de Microsoft','',{now});assert.equal(ntm.query,null);assert.match(ntm.notices.join(' '),/horizonte exacto/);assert.equal(ntm.alternatives![0].query.metric,'forwardPeCurrent');
 for(const [prompt,metric]of [['EV/EBITDA actual de Microsoft','enterpriseToEbitdaCurrent'],['Precio sobre valor contable de Apple','priceToBookCurrent'],['PER TTM actual de Microsoft','trailingPeCurrent']] as const)assert.equal((await interpretAnalytics(prompt,'',{now})).query?.metric,metric);
});

test('specific fiscal metric aliases map to compatible definitions and do not spend model tokens',async()=>{
 for(const [prompt,metric,denominator]of [['Margen operativo de Microsoft','operatingIncome','revenue'],['I+D sobre ingresos de Microsoft','researchDevelopment','revenue'],['Ratio corriente de Microsoft','currentAssets','currentLiabilities'],['Caja sobre pasivos corrientes de Microsoft','cash','currentLiabilities'],['CapEx sobre flujo de caja operativo de Microsoft','capex','operatingCashFlow'],['Deuda neta de Microsoft','netDebt',undefined]] as const){const result=await interpretAnalytics(prompt,'',{now,generate:async()=>{throw Error('rules should resolve');}});assert.equal(result.query?.metric,metric,prompt);assert.equal(result.query?.denominator,denominator,prompt);assert.equal(result.interpretedBy,'rules');}
 for(const prompt of ['Research and development de Microsoft','R&D de Microsoft'])assert.equal((await interpretAnalytics(prompt,'',{now})).query?.metric,'researchDevelopment');
});

test('operating margins, R&D intensity and current ratio calculate in correct units with null incompatible denominators',async()=>{
 const data=fund([{date:'2026-06-30',currency:'USD',filingDate:'2026-07-30',periodType:'3M',values:{revenue:100,operatingIncome:30,researchDevelopment:15,currentAssets:200,currentLiabilities:80}},{date:'2026-09-30',currency:'USD',filingDate:'2026-10-30',periodType:'3M',values:{revenue:0,operatingIncome:30,currentAssets:200,currentLiabilities:null}}]);
 for(const [metric,denominator,expected,unit]of [['operatingIncome','revenue',30,'%'],['researchDevelopment','revenue',15,'%'],['currentAssets','currentLiabilities',2.5,'x']] as const){const result=await executeAnalytics(financial({metric,operation:'ratio',denominator}),{now,fundamentals:async()=>data});assert.equal(result.series[0].points[0].value,expected);assert.equal(result.series[0].unit,unit);assert.equal(result.series[0].points[1].value,null);}
});

test('net debt is deterministic debt minus cash, keeps net cash negative, exact period sources and no export rights promotion',async()=>{
 const data=fund([{date:'2026-06-30',currency:'USD',filingDate:'2026-07-30',periodType:'3M',values:{totalDebt:100,cash:150,netDebt:999},valueSourceIds:{cash:'other'}},{date:'2026-09-30',currency:'USD',filingDate:'2026-10-30',periodType:'3M',values:{totalDebt:100,netDebt:999}}]);
 const result=await executeAnalytics(financial({metric:'netDebt'}),{now,fundamentals:async()=>data});assert.equal(result.series[0].points[0].value,-50);assert.deepEqual(result.series[0].points[0].sourceIds,['sec','other']);assert.equal(result.series[0].points[1].value,null);assert.equal(result.export.table,false);
});

test('SEC, Yahoo and reactivated EODHD adapters map specific published fields without using estimates or incompatible periods',()=>{
 const fact=(val:number,start?:string)=>({val,start,end:'2026-09-30',filed:'2026-10-30',form:'10-Q'});
 const sec=analyticsFundamentalsFromSec('MSFT',{cik:789019,facts:{'us-gaap':{OperatingIncomeLoss:{units:{USD:[fact(25,'2026-07-01')]}},ResearchAndDevelopmentExpense:{units:{USD:[fact(10,'2026-07-01')]}},AssetsCurrent:{units:{USD:[fact(200)]}},LiabilitiesCurrent:{units:{USD:[fact(80)]}}}}},now)!;
 assert.equal(sec.rows.find(row=>row.periodType==='3M')!.values.operatingIncome,25);assert.equal(sec.rows.find(row=>row.periodType==='3M')!.values.currentAssets,200);assert.equal(sec.source.exportAllowed,true);
 const ts=['OperatingIncome','ResearchAndDevelopment','CurrentAssets','CurrentLiabilities'].map((field,i)=>({meta:{type:['quarterly'+field],symbol:['MSFT']},['quarterly'+field]:[{asOfDate:'2026-09-30',currencyCode:'USD',periodType:'3M',reportedValue:{raw:i+10}}]}));
 const yahoo=analyticsFundamentalsFromTimeseries('MSFT',ts,undefined,now)!;assert.equal(yahoo.rows[0].values.researchDevelopment,11);assert.equal(yahoo.rows[0].values.currentLiabilities,13);
 const eod=analyticsFundamentalsFromEodhd('MSFT',{General:{Code:'MSFT',CurrencyCode:'USD',UpdatedAt:'2026-11-20'},Financials:{Income_Statement:{quarterly:{q:{date:'2026-09-30',currency_symbol:'USD',operatingIncome:25,researchDevelopment:10}}},Balance_Sheet:{quarterly:{q:{date:'2026-09-30',currency_symbol:'USD',totalCurrentAssets:200,totalCurrentLiabilities:80}}}}},now)!;assert.equal(eod.rows[0].values.currentAssets,200);assert.equal(eod.rows[0].values.operatingIncome,25);
});

test('MensorLab executes current multiples through the shared provider and preserves estimates and source dates',async()=>{
 const result=await executeMensorLab({version:1,studies:[{id:'valuation',name:'Actual forward multiple',kind:'analytics',query:query({assets:['MSFT']})}]},{now,valuation:async symbol=>analyticsValuationFromSummary(symbol,summary(),now)});
 assert.equal(result.results[0].analytics.table[0].values.MSFT,25);assert.equal(result.definition.studies[0].query.dataKind,'estimate');assert.equal(result.results[0].analytics.sources[0].dataThrough,new Date(quoteAt).toISOString());assert.deepEqual(result.results[0].metrics,[]);
});
