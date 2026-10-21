import test from 'node:test';
import assert from 'node:assert/strict';
import {eodhdFundamentalRaw,normalizeEodhdSummary,normalizeEodhdQuarterly,normalizeEodhdTimeseries} from '../supabase/functions/analyze-ticker/eodhd-fundamentals.ts';

const stock=()=>({General:{Code:'TEST',Type:'Common Stock',Name:'Example Company',Exchange:'NASDAQ',CurrencyCode:'USD',CountryName:'USA',CountryISO:'US',UpdatedAt:'2026-10-21',AddressData:{Country:'United States'},Description:'Example business.'},Highlights:{MarketCapitalization:9e9,ProfitMargin:.12,ReturnOnEquityTTM:.45,RevenueTTM:2e9,DividendYield:.015,MostRecentQuarter:'2026-06-30',EPSEstimateNextYear:4.2},Valuation:{TrailingPE:20,ForwardPE:18,EnterpriseValue:9.5e9,EnterpriseValueEbitda:13},SharesStats:{PercentInstitutions:65,PercentInsiders:1.5,ShortPercentFloat:.02,SharesOutstanding:2e8},Technicals:{Beta:1.2,SharesShort:1e6},AnalystRatings:{Rating:4.25,TargetPrice:42,StrongBuy:5,Buy:5,Hold:3,Sell:1,StrongSell:0},Holders:{Institutions:{0:{name:'Institution Example',date:'2026-06-30',currentShares:50000,totalShares:3,change_p:-4}}},Earnings:{Trend:{Quarterly:{0:{date:'2026-12-31',period:'+1q',fiscalQuarter:'Q4',earningsEstimateAvg:'1.2',epsTrendCurrent:'1.2'}},Annual:{0:{date:'2026-12-31',period:'0y',earningsEstimateAvg:'4.1',revenueEstimateAvg:'2000000000'}}}}});

test('stock summary keeps percentage scales, monetary precision and source identity without manufacturing a market price',()=>{
 const summary=normalizeEodhdSummary(stock(),'TEST')!;
 assert.equal(summary.price.marketCap,9e9);assert.equal(summary.price.currency,'USD');assert.ok(!('regularMarketPrice' in summary.price));
 assert.equal(summary.financialData.returnOnEquity,.45);assert.equal(summary.financialData.profitMargins,.12);assert.equal(summary.summaryDetail.dividendYield,.015);
 assert.equal(summary.defaultKeyStatistics.heldPercentInstitutions,.65);assert.equal(summary.defaultKeyStatistics.heldPercentInsiders,.015);assert.equal(summary.defaultKeyStatistics.shortPercentOfFloat,.02);
 assert.equal(summary.assetProfile.country,'United States');assert.equal(summary.eodhd.updatedAt,'2026-10-21');assert.equal(summary.eodhd.financialCurrency,null);
});

test('consensus reverses the documented rating scale and disclosed positions never become firm recommendations or net cash flows',()=>{
 const summary=normalizeEodhdSummary(stock(),'TEST')!;
 assert.equal(summary.financialData.recommendationMean,1.75);assert.equal(summary.financialData.numberOfAnalystOpinions,14);assert.equal(summary.financialData.targetMeanPrice,42);
 assert.deepEqual(summary.recommendationTrend.trend,[{period:'0m',strongBuy:5,buy:5,hold:3,sell:1,strongSell:0}]);
 const holder=summary.institutionOwnership.ownershipList[0];assert.equal(holder.position,50000);assert.equal(holder.pctHeld,.03);assert.equal(holder.pctChange,-.04);
 assert.ok(!summary.upgradeDowngradeHistory);assert.ok(!('target' in holder)&&!('recommendation' in holder)&&!('value' in holder));assert.equal(summary.eodhd.institutionalData.doesNotMeasureNetFlows,true);
});

test('non-US target currencies and exchange countries are not assumed to be issuer or trading currencies',()=>{
 const raw=stock();raw.General.CurrencyCode='GBP';delete (raw.General as any).AddressData;
 const summary=normalizeEodhdSummary(raw,'TEST.L')!;assert.ok(!('targetMeanPrice' in summary.financialData));assert.equal(summary.eodhd.analystConsensus.targetCurrency,null);assert.ok(!('country' in summary.assetProfile));
 assert.ok(!('financialCurrency' in summary.financialData)); // Trading GBP does not prove the issuer's financial reporting currency.
});

test('v1.1 preserves separate annual and quarterly estimates sharing the same date; legacy trend also works',()=>{
 const raw=stock(),summary=normalizeEodhdSummary(raw,'TEST')!,trend=summary.earningsTrend.trend;
 assert.equal(trend.length,2);assert.equal(trend.find((t:any)=>t.estimatePeriod==='quarterly').quarter,'Q4');assert.equal(trend.find((t:any)=>t.estimatePeriod==='annual').earningsEstimate.avg,4.1);
 (raw.Earnings as any).Trend={0:{date:'2026-12-31',period:'+1q',earningsEstimateAvg:'1.2'}};
 assert.equal(normalizeEodhdSummary(raw,'TEST')?.earningsTrend.trend[0].earningsEstimate.avg,1.2);
});

const etf=()=>({General:{Code:'FUND',Type:'ETF',Name:'Example ETF',CurrencyCode:'USD',UpdatedAt:'2026-10-21'},Technicals:{Beta:.9},ETF_Data:{Company_Name:'Example Fund Manager',Domicile:'Ireland',NetExpenseRatio:.0015,Yield:2.5,TotalAssets:'2500000000',Asset_Allocation:{'Stock US':{'Net_Assets_%':60},'Stock non-US':{'Net_Assets_%':39},Cash:{'Net_Assets_%':1}},Sector_Weights:{Technology:{'Equity_%':30},Healthcare:{'Equity_%':10}},Top_10_Holdings:{'AAPL.US':{Code:'AAPL',Exchange:'US',Name:'Apple',Country:'United States','Assets_%':7.5},'ASML.AS':{Code:'ASML',Exchange:'AS',Name:'ASML','Assets_%':3}},Performance:{Returns_YTD:12,Returns_1Y:16,'1y_Volatility':14}}});
test('ETF normalizes documented percentages, preserves raw ratios and separates total return from price change',()=>{
 const summary=normalizeEodhdSummary(etf(),'FUND')!;
 assert.equal(summary.quoteType.quoteType,'ETF');assert.equal(summary.fundProfile.feesExpensesInvestment.annualReportExpenseRatio,.0015);assert.equal(summary.summaryDetail.yield,.025);assert.equal(summary.summaryDetail.totalAssets,2.5e9);
 assert.equal(summary.defaultKeyStatistics.ytdReturn,.12);assert.ok(!('52WeekChange' in summary.defaultKeyStatistics));assert.equal(summary.eodhd.fund.totalReturn1Year,.16);
 assert.equal(summary.topHoldings.stockPosition,.99);assert.equal(summary.topHoldings.cashPosition,.01);assert.deepEqual(summary.topHoldings.sectorWeightings,[{technology:.3},{healthcare:.1}]);
 assert.equal(summary.topHoldings.holdings[0].holdingPercent,.075);assert.equal(summary.topHoldings.holdings[0].symbol,'AAPL');assert.equal(summary.topHoldings.holdings[1].symbol,'ASML.AS');
 assert.equal(summary.assetProfile.country,'Ireland');assert.ok(!summary.financialData);assert.ok(!summary.recommendationTrend);
});

test('unknown fund allocations, invalid numeric strings and null values stay unavailable rather than zero',()=>{
 const raw=etf();delete (raw.ETF_Data.Asset_Allocation as any)['Stock non-US'];(raw.ETF_Data as any).TotalAssets='12abc';(raw.ETF_Data as any).Yield='';
 const summary=normalizeEodhdSummary(raw,'FUND')!;assert.ok(!('stockPosition' in summary.topHoldings));assert.ok(!('totalAssets' in summary.summaryDetail));assert.ok(!('yield' in summary.summaryDetail));
 assert.equal(normalizeEodhdSummary(null,'AAPL'),null);assert.equal(normalizeEodhdSummary({error:'not available'},'AAPL'),null);
});

function statements(){return {General:{Code:'TEST',Type:'Common Stock',CurrencyCode:'USD'},Financials:{Income_Statement:{currency_symbol:'EUR',quarterly:{0:{date:'2026-06-30',filing_date:'2026-07-20',currency_symbol:'EUR',totalRevenue:'1200000000',grossProfit:'600000000',netIncome:'120000000',ebitda:'300000000'},1:{date:'2025-06-30',currency_symbol:'EUR',totalRevenue:'1000000000'}}},Cash_Flow:{quarterly:{0:{date:'2026-06-30',currency_symbol:'EUR',totalCashFromOperatingActivities:'200000000',capitalExpenditures:'50000000'}}},Balance_Sheet:{quarterly:{0:{date:'2026-06-30',currency_symbol:'EUR',cash:'100000000',shortLongTermDebtTotal:'300000000',totalStockholderEquity:'600000000',totalAssets:'1000000000'}}}},Earnings:{History:{0:{date:'2026-06-30',currency:'EUR',epsActual:1.5}}}};}

test('quarterly statements join fiscal dates and currency, calculate auditable FCF and retain full raw precision',()=>{
 const rows=normalizeEodhdQuarterly(statements()),last=rows[0];assert.equal(rows.length,2);assert.equal(last.period,'2026-06-30');assert.equal(last.currency,'EUR');assert.equal(last.filingDate,'2026-07-20');
 assert.equal(last.revenue,'€1.20B');assert.equal(last.revenueGrowth,'+20.0%');assert.equal(last.numeric.freeCashFlow,150000000);assert.equal(last.numeric.netDebt,200000000);assert.equal(last.eps,'€1.50');
 const series=normalizeEodhdTimeseries(statements(),'TEST');const capex=series.find(s=>s.meta.type[0]==='quarterlyCapitalExpenditure')!;assert.equal(capex.quarterlyCapitalExpenditure[0].reportedValue.raw,-50000000);assert.equal(capex.quarterlyCapitalExpenditure[0].currencyCode,'EUR');
 const rev=series.find(s=>s.meta.type[0]==='quarterlyTotalRevenue')!;assert.equal(rev.quarterlyTotalRevenue[0].reportedValue.raw,1200000000);assert.equal(rev.quarterlyTotalRevenue[0].periodType,'3M');
});

test('incompatible currency statements and missing prior-year observations never fill quarterly gaps',()=>{
 const raw=statements();raw.Financials.Cash_Flow.quarterly[0].currency_symbol='USD';delete (raw.Financials.Income_Statement.quarterly as any)[1];
 const last=normalizeEodhdQuarterly(raw)[0];assert.equal(last.revenueGrowth,'N/D');assert.equal(last.numeric.operatingCF,null);assert.equal(last.numeric.freeCashFlow,null);assert.equal(last.freeCashFlow,'N/D');
});

test('fundamentals request uses the versioned server route once with six-hour caching and no secret in query',async()=>{
 const calls:any[]=[];const raw=await eodhdFundamentalRaw('TEST',async(...args:any[])=>{calls.push(args);return stock() as any;});
 assert.ok(raw);assert.equal(calls.length,1);assert.equal(calls[0][0],'v1.1/fundamentals/TEST.US');assert.deepEqual(calls[0][1],{});assert.equal(calls[0][2].ttlMs,21600000);assert.equal(calls[0][2].cost,10);
 await eodhdFundamentalRaw('../secret',async(...args:any[])=>{calls.push(args);return stock() as any;});assert.equal(calls.length,1);
});

test('fundamentals reject a response for another ticker and skip unsupported non-equity families',async()=>{
 let calls=0;const wrong=await eodhdFundamentalRaw('AAPL',async()=>{calls++;return stock() as any;});assert.equal(wrong,null);
 for(const symbol of ['EURUSD=X','BTC-USD','GB10Y.GBOND'])assert.equal(await eodhdFundamentalRaw(symbol,async()=>{calls++;return stock() as any;}),null);
 assert.equal(calls,1);
 const index=await eodhdFundamentalRaw('GSPC.INDX',async()=>({General:{Code:'GSPC',Type:'INDEX',Name:'S&P 500'}} as any));assert.equal(index?.General.Type,'INDEX');
});

test('verified SEC identifiers reach document research while malformed and all-zero identifiers stay unavailable',()=>{
 const raw=stock();(raw.General as any).CIK='1652044';assert.equal(normalizeEodhdSummary(raw,'TEST')?.eodhd.cik,'0001652044');
 for(const cik of ['0000000000','CIK=123','12345678901','../123']){(raw.General as any).CIK=cik;assert.equal(normalizeEodhdSummary(raw,'TEST')?.eodhd.cik,null);}
});

test('timeseries expose longer verified history with a hard cap while report rows remain bounded and preserve zero versus gaps',()=>{
 const quarterly=Object.fromEntries(Array.from({length:240},(_,i)=>{const day=new Date(Date.UTC(2026,6-i*3,0)).toISOString().slice(0,10);return [day,{date:day,currency_symbol:'USD',totalRevenue:i===0?'0':String(1e9+i),netIncome:i===1?null:'0'}];}));
 const raw={General:{Code:'TEST',Type:'Common Stock'},Financials:{Income_Statement:{currency_symbol:'USD',quarterly}}};
 assert.equal(normalizeEodhdQuarterly(raw).length,24);assert.equal(normalizeEodhdQuarterly(raw,1000).length,200);assert.equal(normalizeEodhdQuarterly(raw,0).length,0);
 const series=normalizeEodhdTimeseries(raw,'TEST'),revenue=series.find(row=>row.meta.type[0]==='quarterlyTotalRevenue')!.quarterlyTotalRevenue,net=series.find(row=>row.meta.type[0]==='quarterlyNetIncome')!.quarterlyNetIncome;
 assert.equal(revenue.length,200);assert.equal(revenue[0].reportedValue.raw,0);assert.equal(revenue[0].currencyCode,'USD');assert.equal(net.length,199);assert.equal(net[0].reportedValue.raw,0);
});

test('future fiscal periods and future filing dates cannot enter published quarterly statements',()=>{
 const raw=statements();(raw.Financials.Income_Statement.quarterly as any)[2]={date:'2026-12-31',filing_date:'2027-01-31',totalRevenue:'9000000000'};(raw.Financials.Income_Statement.quarterly as any)[3]={date:'2026-09-30',filing_date:'2026-11-01',totalRevenue:'8000000000'};
 const rows=normalizeEodhdQuarterly(raw,200,Date.parse('2026-10-21T12:00:00Z'));assert.deepEqual(rows.map(row=>row.period),['2026-06-30','2025-06-30']);
 (raw.Financials.Cash_Flow.quarterly[0] as any).filing_date='2026-11-01';(raw.Earnings.History[0] as any).reportDate='2026-11-01';const strict=normalizeEodhdQuarterly(raw,24,Date.parse('2026-10-21T12:00:00Z'))[0];assert.equal(strict.numeric.operatingCF,null);assert.equal(strict.numeric.freeCashFlow,null);assert.equal(strict.numeric.eps,null);
});
