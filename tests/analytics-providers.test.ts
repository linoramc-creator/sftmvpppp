import test from 'node:test';
import assert from 'node:assert/strict';
import {analyticsFundamentalsFromTimeseries,analyticsFundamentalsFromSec,analyticsFundamentalsFromEodhd,normalizeAnalyticsPrices,mergeAnalyticsFundamentals} from '../supabase/functions/analyze-ticker/analytics-providers.ts';
import type {AnalyticsFundamentalInput,AnalyticsSource} from '../supabase/functions/analyze-ticker/analytics-types.ts';
const now=Date.parse('2026-11-11T18:00:00Z');
const source=(id:string):AnalyticsSource=>({id,name:id,url:'https://example.com/',fetchedAt:new Date(now).toISOString(),dataThrough:'2026-06-30',exportAllowed:true,exportNote:'Fixture.'});
function timeSeries(type:string,periodType='3M',value:number|null=100,currencyCode='USD'){return {meta:{type:[type],symbol:['MSFT']},[type]:[{asOfDate:'2026-06-30',periodType,currencyCode,reportedValue:{raw:value}}]};}
function facts(tag:string,rows:unknown[]){return {cik:789019,facts:{'us-gaap':{[tag]:{units:{USD:rows}}}}};}
function fact(start:string|undefined,end:string,value:number,extra:Record<string,unknown>={}){return {start,end,val:value,filed:'2026-10-28',form:'10-Q',accn:'0000789019-26-000001',...extra};}

test('Yahoo financial fields must prove3M/12M duration and actual statement currency',()=>{
  const input=[timeSeries('quarterlyTotalRevenue','3M',100),timeSeries('quarterlyOperatingCashFlow','6M',999),timeSeries('quarterlyNetIncome','3M',null),timeSeries('annualTotalRevenue','12M',400),timeSeries('quarterlyGrossProfit','3M',10,'')];
  const out=analyticsFundamentalsFromTimeseries('MSFT',input,undefined,now)!;
  assert.equal(out.rows.find(r=>r.periodType==='3M')!.values.revenue,100);assert.equal(out.rows.find(r=>r.periodType==='3M')!.values.operatingCashFlow,undefined);assert.equal(out.rows.find(r=>r.periodType==='12M')!.values.revenue,400);assert.equal(out.rows.find(r=>r.periodType==='3M')!.values.grossProfit,undefined);
});
test('CapEx is a positive totaloutflow and FCF only derives when both compatible fields exist',()=>{
  const out=analyticsFundamentalsFromTimeseries('MSFT',[timeSeries('quarterlyOperatingCashFlow','3M',120),timeSeries('quarterlyCapitalExpenditure','3M',-50)],source('test'),now)!;
  assert.equal(out.rows[0].values.capex,50);assert.equal(out.rows[0].values.freeCashFlow,70);assert.equal(out.rows[0].values.capexAI,undefined);
  const incomplete=analyticsFundamentalsFromTimeseries('MSFT',[timeSeries('quarterlyOperatingCashFlow','3M',120)],undefined,now)!;assert.equal(incomplete.rows[0].values.freeCashFlow,undefined);
});
test('duplicate conflicting statement fields cannot be reinstated by a third duplicate',()=>{
  const out=analyticsFundamentalsFromTimeseries('MSFT',[timeSeries('quarterlyTotalRevenue','3M',100),timeSeries('quarterlyTotalRevenue','3M',200),timeSeries('quarterlyTotalRevenue','3M',100)],undefined,now)!;
  assert.equal(out.rows[0].values.revenue,undefined);
});
test('SEC direct quarters retain fiscal ends, filing dates and public export rights',()=>{
  const out=analyticsFundamentalsFromSec('MSFT',facts('Revenues',[fact('2026-04-01','2026-06-30',100)]),now)!;
  assert.equal(out.rows[0].values.revenue,100);assert.equal(out.rows[0].filingDate,'2026-10-28');assert.equal(out.rows[0].date,'2026-06-30');assert.equal(out.source.exportAllowed,true);
  assert.equal(analyticsFundamentalsFromSec('AAPL',facts('Revenues',[fact('2026-04-01','2026-06-30',100)]),now),null);
});
test('SEC accumulated cash flows become standalonequarters only through compatible fiscalstart differences',()=>{
  const out=analyticsFundamentalsFromSec('MSFT',facts('NetCashProvidedByUsedInOperatingActivities',[fact('2026-01-01','2026-03-31',100),fact('2026-01-01','2026-06-30',230),fact('2026-01-01','2026-09-30',390)]),now)!;
  const quarterly=out.rows.filter(r=>r.periodType==='3M');assert.deepEqual(quarterly.map(r=>r.values.operatingCashFlow),[100,130,160]);assert.ok(out.notes!.some(n=>n.includes('YTD')));
  const wrong=analyticsFundamentalsFromSec('MSFT',facts('NetCashProvidedByUsedInOperatingActivities',[fact('2025-12-01','2026-03-31',100),fact('2026-01-01','2026-06-30',230)]),now);assert.equal(wrong,null);
});
test('SEC annual minus nine months derives Q4 without renaming the annual observation as quarterly',()=>{
  const out=analyticsFundamentalsFromSec('MSFT',facts('PaymentsToAcquirePropertyPlantAndEquipment',[fact('2025-07-01','2026-03-31',90),fact('2025-07-01','2026-06-30',130,{form:'10-K'})]),now)!;
  assert.equal(out.rows.find(r=>r.periodType==='3M')!.values.capex,40);assert.equal(out.rows.find(r=>r.periodType==='12M')!.values.capex,130);
});
test('SEC productive-asset CapEx includes disclosed software and intangibles, with a visible comparability note',()=>{
  const input=facts('PaymentsToAcquireProductiveAssets',[fact('2026-01-01','2026-03-31',100),fact('2026-01-01','2026-06-30',240)]);
  input.cik=1018724;
  const out=analyticsFundamentalsFromSec('AMZN',input,now)!;
  assert.deepEqual(out.rows.filter(r=>r.periodType==='3M').map(r=>r.values.capex),[100,140]);
  assert.ok(out.notes!.some(n=>n.includes('software y otros intangibles')&&n.includes('AMZN')));
  assert.ok(out.rows.every(r=>r.values.capexAI===undefined));
});
test('deferred CapEx commitments, lease liabilities, M&A assets and net asset disposal cash flows are not substitutes for CapEx',()=>{
  for(const tag of ['CapitalExpendituresIncurredButNotYetPaid','CapitalLeaseObligationsIncurred','BusinessCombinationRecognizedIdentifiableAssetsAcquiredAndLiabilitiesAssumedPropertyPlantAndEquipment','PaymentsForProceedsFromProductiveAssets']){
    assert.equal(analyticsFundamentalsFromSec('MSFT',facts(tag,[fact('2026-01-01','2026-03-31',100)]),now),null);
  }
});
test('SEC conflicts on the same filing date cannot reenter, and future filings are never accepted',()=>{
  const out=analyticsFundamentalsFromSec('MSFT',facts('Revenues',[fact('2026-04-01','2026-06-30',100),fact('2026-04-01','2026-06-30',200),fact('2026-04-01','2026-06-30',100),fact('2026-07-01','2026-09-30',200,{filed:'2026-12-01'})]),now);assert.equal(out,null);
});
test('SEC quarter extraction does not confuse 6M facts, estimates or point-in-time-only balance sheets with flows',()=>{
  assert.equal(analyticsFundamentalsFromSec('MSFT',facts('Revenues',[fact('2026-01-01','2026-06-30',200)]),now),null);
  assert.equal(analyticsFundamentalsFromSec('MSFT',facts('Assets',[fact(undefined,'2026-06-30',500)]),now),null);
  assert.equal(analyticsFundamentalsFromSec('MSFT',facts('Revenues',[fact('2026-04-01','2026-06-30',100,{form:'8-K'})]),now),null);
});
test('EODHD quarterly cashflow absent explicitduration is not blindly stamped3M',()=>{
  const input={General:{Code:'MSFT',Type:'Common Stock'},Financials:{Income_Statement:{currency_symbol:'USD',quarterly:{'2026-06-30':{date:'2026-06-30',totalRevenue:'100'}}},Cash_Flow:{currency_symbol:'USD',quarterly:{'2026-06-30':{date:'2026-06-30',capitalExpenditures:'50',totalCashFromOperatingActivities:'120'}}}}};
  const missing=analyticsFundamentalsFromEodhd('MSFT',input,now)!;assert.equal(missing.rows[0].values.capex,undefined);assert.equal(missing.rows[0].values.operatingCashFlow,undefined);
  (input.Financials.Cash_Flow.quarterly['2026-06-30'] as any).periodType='3M';const proven=analyticsFundamentalsFromEodhd('MSFT',input,now)!;assert.equal(proven.rows[0].values.capex,50);assert.equal(proven.rows[0].values.freeCashFlow,70);
});
test('primary provider values remain preferred and exact-compatible fallback fields retain their own source IDs',()=>{
  const a:AnalyticsFundamentalInput={symbol:'MSFT',source:source('primary'),rows:[{date:'2026-06-30',currency:'USD',filingDate:'2026-07-20',periodType:'3M',values:{revenue:100,capex:null}}]};
  const b:AnalyticsFundamentalInput={symbol:'MSFT',source:source('fallback'),rows:[{date:'2026-06-30',currency:'USD',filingDate:'2026-07-25',periodType:'3M',values:{revenue:999,capex:50}},{date:'2026-06-29',currency:'USD',filingDate:null,periodType:'3M',values:{capex:10}}]};
  const merged=mergeAnalyticsFundamentals(a,b)!;const r=merged.rows.find(r=>r.date==='2026-06-30')!;assert.equal(r.values.revenue,100);assert.equal(r.values.capex,50);assert.equal(r.valueSourceIds!.capex,'fallback');assert.equal(r.valueSourceIds!.revenue,'primary');assert.equal(merged.sources!.length,2);assert.equal(merged.rows.length,2);
});
test('price normalization uses split-only close, never dividend-adjusted close and excludes unfinished sessions',()=>{
  const chart={chart:{result:[{meta:{symbol:'MSFT',currency:'USD',instrumentType:'EQUITY',exchangeTimezoneName:'America/New_York',regularMarketTime:now/1000,currentTradingPeriod:{regular:{start:Date.parse('2026-11-11T14:30Z')/1000,end:Date.parse('2026-11-11T21:00Z')/1000}}},timestamp:[Date.parse('2026-11-10T14:30Z')/1000,Date.parse('2026-11-11T14:30Z')/1000],indicators:{quote:[{close:[100,110]}],adjclose:[{adjclose:[90,99]}]}}]}};
  const out=normalizeAnalyticsPrices('MSFT',chart,now)!;assert.deepEqual(out.points,[{date:'2026-11-10',value:100}]);assert.equal(out.adjustment,'split-adjusted-price');
  assert.equal(normalizeAnalyticsPrices('AAPL',chart,now),null);chart.chart.result[0].meta['_provider']='eodhd';assert.equal(normalizeAnalyticsPrices('MSFT',chart,now),null);
});
