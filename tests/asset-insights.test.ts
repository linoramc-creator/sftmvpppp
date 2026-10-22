import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildAssetInsights,buildAssetPriceStudy,loadAssetInsights} from '../supabase/functions/analyze-ticker/asset-insights.ts';

const now=Date.parse('2026-10-21T22:00:00Z');
const chart=(prices:number[],start='2026-06-01')=>({meta:{instrumentType:'EQUITY',currency:'USD',exchangeTimezoneName:'UTC'},timestamp:prices.map((_,i)=>Date.parse(start+'T00:00:00Z')/1000+i*86400),indicators:{quote:[{close:[...prices]}],adjclose:[{adjclose:[...prices]}]}});
const fundamentals=()=>({General:{Code:'TEST',Type:'Common Stock',Name:'Example company',Description:'The company supplies industrial components and recurring maintenance services.',CurrencyCode:'USD',Exchange:'NYSE',AddressData:{Country:'United States'},CountryName:'Exchange country, not issuer domicile',Sector:'Industrials',Industry:'Components',FullTimeEmployees:'12000',UpdatedAt:'2026-10-20'},Highlights:{MarketCapitalization:'4000000000',RevenueTTM:'1200000000',ProfitMargin:'-0.02',OperatingMarginTTM:'0',ReturnOnEquityTTM:'0.08',QuarterlyRevenueGrowthYOY:'0.1',MostRecentQuarter:'2026-06-30'},Valuation:{ForwardPE:'22',EnterpriseValueEbitda:'15'},Financials:{Income_Statement:{currency_symbol:'EUR',quarterly:{a:{date:'2026-06-30',filing_date:'2026-08-01',currency_symbol:'EUR',totalRevenue:'300000000',grossProfit:'120000000',netIncome:'-3000000'},b:{date:'2026-03-31',filing_date:'2026-05-01',currency_symbol:'EUR',totalRevenue:'0',grossProfit:'0',netIncome:'0'},future:{date:'2026-12-31',filing_date:'2027-02-01',currency_symbol:'EUR',totalRevenue:'999999999999'}}},Cash_Flow:{currency_symbol:'EUR',quarterly:{a:{date:'2026-06-30',filing_date:'2026-08-01',currency_symbol:'EUR',totalCashFromOperatingActivities:'30000000',capitalExpenditures:'-10000000'},b:{date:'2026-03-31',currency_symbol:'USD',freeCashFlow:'90000000'}}},Balance_Sheet:{currency_symbol:'EUR',quarterly:{a:{date:'2026-06-30',filing_date:'2026-08-01',currency_symbol:'EUR',cashAndEquivalents:'40000000',shortTermDebt:'5000000',longTermDebt:'10000000'}}}}});

test('reported financials retain period, true currency, zero/negative amounts and million scaling',()=>{
 const result=buildAssetInsights(fundamentals(),chart([100,101]),'TEST',now);
 assert.equal(result.profile.description,fundamentals().General.Description);assert.equal(result.profile.country,'United States');
 assert.equal(result.profile.currency,'USD');assert.equal(result.profile.financialCurrency,'EUR');
 assert.equal(result.financials.unit,'millions');assert.equal(result.financials.scale,1000000);
 assert.deepEqual(result.financials.rows.map(r=>r.period),['2026-03-31','2026-06-30']);
 const [older,latest]=result.financials.rows;assert.equal(older.revenue,0);assert.equal(older.freeCashFlow,null);assert.equal(older.fcfMarginPct,null);
 assert.equal(latest.revenue,300);assert.equal(latest.freeCashFlow,20);assert.ok(Math.abs(latest.fcfMarginPct!-20/300*100)<1e-10);
 assert.equal(latest.netIncome,-3);assert.equal(latest.cash,40);assert.equal(latest.totalDebt,15);assert.equal(latest.netDebt,-25);
 assert.equal(latest.grossMarginPct,40);assert.equal(latest.filingDate,'2026-08-01');assert.equal(latest.currency,'EUR');
 assert.equal(result.metrics.find(m=>m.id==='revenueTtm')?.currency,'EUR');assert.equal(result.metrics.find(m=>m.id==='marketCap')?.currency,'USD');
 assert.equal(result.metrics.find(m=>m.id==='operatingMargin')?.value,0);assert.equal(result.metrics.find(m=>m.id==='profitMargin')?.value,-2);
 assert.equal(result.metrics.find(m=>m.id==='revenueGrowth')?.value,10);
});

test('an absent currency is never replaced with trading currency for reported amounts',()=>{
 const raw=fundamentals();delete (raw.Financials.Income_Statement as any).currency_symbol;delete (raw.Financials.Balance_Sheet as any).currency_symbol;delete (raw.Financials.Cash_Flow as any).currency_symbol;
 const result=buildAssetInsights(raw,chart([100,101]),'TEST',now);assert.equal(result.profile.financialCurrency,null);assert.ok(!result.metrics.some(m=>m.id==='revenueTtm'));
 delete (raw.General as any).AddressData;assert.equal(buildAssetInsights(raw,null,'TEST',now).profile.country,null);
});

test('fund facts keep field-specific percentage scales, correct domiciles and published exposures',()=>{
 const raw={General:{Type:'ETF',Name:'Example fund',CurrencyCode:'USD',CountryName:'United States',Category:'Global equity',UpdatedAt:'2026-10-20'},ETF_Data:{Domicile:'Ireland',Company_Name:'Example manager',Index_Name:'World Index',TotalAssets:'1234567890',NetExpenseRatio:'0.0015',Yield:'2.5',Holdings_Count:'150',Inception_Date:'2015-06-01',Top_10_Holdings:Object.fromEntries(Array.from({length:10},(_,i)=>[`H${i}.US`,{Code:`H${i}`,Exchange:'US',Name:`Holding ${i}`,'Assets_%':i===0?0:2}])),Sector_Weights:{Technology:{'Equity_%':25},Healthcare:{'Equity_%':0}},World_Regions:{Europe:{'Equity_%':30}}}};
 const result=buildAssetInsights(raw,chart([100,101]),'FUND',now);
 assert.equal(result.profile.kind,'etf');assert.equal(result.profile.country,'Ireland');assert.equal(result.fund?.topTenWeightPct,18);assert.equal(result.fund?.topHoldings.at(-1)?.weightPct,0);
 assert.equal(result.metrics.find(m=>m.id==='expenseRatio')?.value,.15);assert.equal(result.metrics.find(m=>m.id==='distributionYield')?.value,2.5);
 assert.deepEqual(result.fund?.sectorWeights,[{name:'Technology',weightPct:25},{name:'Healthcare',weightPct:0}]);assert.equal(result.financials.rows.length,0);
});

test('drawdown duration uses adjusted closes and resets only when the observed high recovers',()=>{
 const raw=chart([100,50,52,48,55]);raw.indicators.adjclose[0].adjclose=[50,50,52,48,55];
 const result=buildAssetPriceStudy(raw,'TEST',now);
 assert.equal(result.adjustment,'adjusted-close');assert.equal(result.underwater[1].drawdownPct,0);
 assert.ok(Math.abs(result.summary.maximumDrawdownPct!-(48/52-1)*100)<1e-10);
 assert.equal(result.underwater[3].sessionsUnderwater,1);assert.equal(result.summary.currentSessionsUnderwater,0);assert.equal(result.summary.longestSessionsUnderwater,1);
 assert.equal(result.summary.sortino,null);assert.equal(result.summary.trendEfficiency20Pct,null);
});

test('mixed adjusted/raw equities are rejected, while FX uses close prices without invented adjustment',()=>{
 const raw=chart([100,101,102]);raw.indicators.adjclose[0].adjclose[1]=null as any;
 assert.equal(buildAssetPriceStudy(raw,'TEST',now).observations,0);
 const fx={...raw,meta:{...raw.meta,instrumentType:'CURRENCY'},indicators:{quote:raw.indicators.quote}};
 const result=buildAssetPriceStudy(fx,'EURUSD=X',now);assert.equal(result.observations,3);assert.equal(result.adjustment,'price');assert.equal(result.summary.currentDrawdownPct,0);
});

test('monthly return calendar has prior-month anchors, skips missing months and labels latest as partial',()=>{
 const raw=chart([100,110,121,100]);raw.timestamp=['2026-06-30','2026-07-31','2026-08-31','2026-10-20'].map(d=>Date.parse(d)/1000);
 const result=buildAssetPriceStudy(raw,'TEST',now);
 assert.deepEqual(result.monthlyReturns.map(m=>[m.year,m.month,m.partial]),[[2026,7,false],[2026,8,false]]);
 assert.ok(Math.abs(result.monthlyReturns[0].returnPct-10)<1e-10);assert.equal(result.monthlyReturns[0].from,'2026-06-30');
 raw.timestamp[3]=Date.parse('2026-09-30')/1000;
 assert.equal(buildAssetPriceStudy(raw,'TEST',now).monthlyReturns.at(-1)?.partial,false);
 raw.timestamp[3]=Date.parse('2026-09-29')/1000;
 assert.equal(buildAssetPriceStudy(raw,'TEST',now).monthlyReturns.at(-1)?.partial,true);
});

test('trend efficiency, semivolatility and Sortino require sufficient data and do not generate infinity',()=>{
 const alternating=Array.from({length:100},(_,i)=>100+Math.sin(i)*5+i*.1),result=buildAssetPriceStudy(chart(alternating),'TEST',now);
 assert.equal(result.summary.returnSamples,99);assert.ok(result.summary.sortino!==null&&Number.isFinite(result.summary.sortino));assert.ok(result.summary.downsideAnnualizedPct!>0);assert.ok(result.summary.upsideAnnualizedPct!>0);
 assert.ok(result.summary.trendEfficiency20Pct!>=0&&result.summary.trendEfficiency20Pct!<=100);
 const monotonic=buildAssetPriceStudy(chart(Array.from({length:100},(_,i)=>100+i)),'TEST',now);assert.ok(Math.abs(monotonic.summary.trendEfficiency20Pct!-100)<1e-9);assert.equal(monotonic.summary.trendDirection20,'up');assert.equal(monotonic.summary.sortino,null);
 const flat=buildAssetPriceStudy(chart(Array(100).fill(100)),'TEST',now);assert.equal(flat.summary.sortino,null);assert.equal(flat.summary.downsideAnnualizedPct,0);assert.equal(flat.summary.trendEfficiency20Pct,0);
});

test('future, incomplete current-day and appended quote observations are excluded',()=>{
 const raw=chart([100,101,102]);raw.timestamp=['2026-10-19T00:00:00Z','2026-10-21T00:00:00Z','2026-10-22T00:00:00Z'].map(d=>Date.parse(d)/1000);
 assert.equal(buildAssetPriceStudy(raw,'TEST',now).observations,1);
 const closed={...raw,meta:{...raw.meta,currentTradingPeriod:{regular:{start:Date.parse('2026-10-21T13:30:00Z')/1000,end:Date.parse('2026-10-21T20:00:00Z')/1000}}}};
 assert.equal(buildAssetPriceStudy(closed,'TEST',now).observations,2);
});

test('loader uses two parallel reads without AI and tolerates individual provider outages',async()=>{
 const requests:string[]=[],raw=chart([100,101]);
 const result=await loadAssetInsights('TEST',{now,fundamentals:async symbol=>{requests.push('fundamentals:'+symbol);throw new Error('unavailable');},read:async (url,_init,options)=>{requests.push(url);assert.equal(options?.acceptPrimary?.({chart:{result:[raw]}}),true);return {chart:{result:[raw]}};}});
 assert.equal(requests.length,2);assert.equal(result.priceStudy.observations,2);assert.equal(result.profile.description,null);assert.equal(result.financials.rows.length,0);
 assert.ok(requests[1].endsWith('/TEST?range=2y&interval=1d'));
 const fundamentalOnly=await loadAssetInsights('TEST',{now,fundamentals:async()=>fundamentals(),read:async()=>{throw new Error('history unavailable');}});
 assert.equal(fundamentalOnly.priceStudy.observations,0);assert.equal(fundamentalOnly.financials.rows.length,2);
});

test('return behavior calculates real horizons and a complete distribution without duplicating drawdown',()=>{
 const prices=[100,110,99,99,108.9,103.455,...Array(16).fill(103.455)],result=buildAssetPriceStudy(chart(prices),'TEST',now),b=result.behavior;
 assert.equal(b.samples,21);assert.equal(b.distribution.reduce((sum,r)=>sum+r.count,0),21);
 assert.ok(Math.abs(b.distribution.reduce((sum,r)=>sum+r.frequencyPct,0)-100)<1e-9);
 assert.ok(Math.abs(b.horizons.find(h=>h.sessions===20)!.returnPct!-(103.455/110-1)*100)<1e-9);
 assert.equal(b.horizons.find(h=>h.sessions===60)!.returnPct,null);
 assert.equal(b.momentum.length,2);assert.equal(b.momentum[0].return60Pct,null);
 assert.ok(Math.abs(b.positiveSessionsPct!-2/21*100)<1e-9);
 assert.ok(Math.abs(b.medianGainPct!-10)<1e-9);assert.ok(Math.abs(b.medianLossPct!+7.5)<1e-9);
});

test('return behavior bounds statistics to 252 returns and handles unchanged or insufficient history honestly',()=>{
 const steady=buildAssetPriceStudy(chart(Array(300).fill(100),'2025-01-01'),'TEST',now).behavior;
 assert.equal(steady.samples,252);assert.equal(steady.positiveSessionsPct,0);assert.equal(steady.medianGainPct,null);assert.equal(steady.medianLossPct,null);
 assert.equal(steady.distribution.find(r=>r.label==='0 a 1%')?.count,252);
 assert.equal(steady.horizons.find(h=>h.sessions===252)?.returnPct,0);
 const empty=buildAssetPriceStudy(null,'TEST',now).behavior;
 assert.equal(empty.samples,0);assert.equal(empty.positiveSessionsPct,null);assert.deepEqual(empty.momentum,[]);assert.ok(empty.horizons.every(h=>h.returnPct===null));
});

test('distribution decimal boundaries do not misclassify exact one- and five-percent returns',()=>{
 const result=buildAssetPriceStudy(chart([100,99,100,105,100,95,100,101]),'TEST',now).behavior;
 const count=(label:string)=>result.distribution.find(r=>r.label===label)?.count;
 assert.equal(count('< −5%'),0);assert.equal(count('−5 a −3%'),2);
 assert.equal(count('−2 a −1%'),0);assert.equal(count('−1 a 0%'),1);
 assert.equal(count('0 a 1%'),0);assert.equal(count('1 a 2%'),2);assert.equal(count('≥ 5%'),2);
});
