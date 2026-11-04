import {test} from 'node:test';import assert from 'node:assert/strict';
import {createStockRadarFallback,stockRadarRawFromYahoo,stockRadarRawFromFmp,stockRadarHistoryFromRelative} from '../supabase/functions/analyze-ticker/stock-radar-fallback.ts';
import {normalizeEodhdQuarterly} from '../supabase/functions/analyze-ticker/eodhd-fundamentals.ts';
import {loadStockResearchRadar} from '../supabase/functions/analyze-ticker/stock-research-radar.ts';
const now=Date.parse('2026-11-03T15:00Z'),dates=['2025-06-30','2025-09-30','2025-12-31','2026-03-31','2026-06-30'];
const profile=(symbol='DEMO',type='EQUITY')=>({quoteType:{symbol,quoteType:type,longName:'Demonstration company'},assetProfile:{sector:'Technology'},price:{symbol,currency:'USD',regularMarketTime:Date.parse('2026-11-02T21:00Z')/1000,marketCap:{raw:5e9}},financialData:{financialCurrency:'USD'}} as any);
function timeseries(){return Object.entries({quarterlyTotalRevenue:100e6,quarterlyNetIncome:20e6,quarterlyOperatingCashFlow:35e6,quarterlyCapitalExpenditure:-10e6,quarterlyFreeCashFlow:25e6}).map(([type,value])=>({meta:{type:[type]},[type]:dates.map((asOfDate,i)=>({asOfDate,currencyCode:'USD',periodType:'3M',reportedValue:{raw:type==='quarterlyTotalRevenue'?value+i*20e6:value}}))}));}
const fmpProfile={symbol:'DEMO',companyName:'Demonstration company',currency:'USD',sector:'Technology',marketCap:5e9,isEtf:false,isFund:false};
const fmpRows=(cash=false)=>dates.map((date,i)=>({symbol:'DEMO',date,filingDate:new Date(Date.parse(date)+35*86400000).toISOString().slice(0,10),reportedCurrency:'USD',period:'Q'+(i%4+1),revenue:100e6+i*20e6,netIncome:20e6,operatingCashFlow:35e6,capitalExpenditure:-10e6,freeCashFlow:25e6}));
const fmpQuote={symbol:'DEMO',timestamp:Date.parse('2026-11-02T21:00Z')/1000,marketCap:5e9};

test('published quarterly series normalize absolute amounts/currency without formatting or invented forecast/publication dates',()=>{
 const raw=stockRadarRawFromYahoo('DEMO',profile(),timeseries(),now)!;assert.ok(raw);assert.equal(raw.General.UpdatedAt,'2026-11-02');assert.equal(raw._radarFallback.capturedAt,new Date(now).toISOString());assert.equal(raw._radarFallback.publicationDate,null);assert.equal(raw.Earnings,undefined);
 const quarters=normalizeEodhdQuarterly(raw,10,now);assert.equal(quarters.length,5);assert.equal(quarters[0].numeric.revenue,180e6);assert.equal(quarters[0].numeric.freeCashFlow,25e6);assert.equal(quarters[0].currency,'USD');assert.equal(quarters[0].filingDate,null);
});
test('fallback rejects wrong identity, missing/old/future quote dates and malformed numbers instead of relabeling them as current',()=>{
 assert.equal(stockRadarRawFromYahoo('OTHER',profile(),timeseries(),now),null);
 for(const regularMarketTime of [null,0,now/1000+1,(now-20*86400000)/1000]){const p=profile();p.price.regularMarketTime=regularMarketTime;assert.equal(stockRadarRawFromYahoo('DEMO',p,timeseries(),now),null);}
 const p=profile();p.price.marketCap={fmt:'5B'};assert.equal(stockRadarRawFromYahoo('DEMO',p,timeseries(),now)!.Highlights.MarketCapitalization,null);
});
test('annual/YTD observations and future fiscal dates cannot masquerade as quarterly cash flow',()=>{
 const series=timeseries() as any[];series[0].quarterlyTotalRevenue.push({asOfDate:'2027-03-31',periodType:'3M',currencyCode:'USD',reportedValue:{raw:999}});series[2].quarterlyOperatingCashFlow=series[2].quarterlyOperatingCashFlow.map((p:any)=>({...p,periodType:'12M'}));
 const raw=stockRadarRawFromYahoo('DEMO',profile(),series,now)!;assert.equal(Object.keys(raw.Financials.Income_Statement.quarterly).length,5);assert.equal(Object.keys(raw.Financials.Cash_Flow.quarterly).length,5);assert.ok(normalizeEodhdQuarterly(raw,10,now).every(q=>q.numeric.operatingCF===null));
});
test('point currencies remain authoritative and conflicting statement currencies do not get silently merged',()=>{
 const series=timeseries();for(const row of series)for(const point of row[row.meta.type[0]])point.currencyCode='EUR';const raw=stockRadarRawFromYahoo('DEMO',profile(),series,now)!;assert.equal(normalizeEodhdQuarterly(raw,10,now)[0].currency,'EUR');assert.equal(raw.General.CurrencyCode,'USD');
 const mismatch=timeseries();for(const point of mismatch[2].quarterlyOperatingCashFlow)point.currencyCode='EUR';const mixed=stockRadarRawFromYahoo('DEMO',profile(),mismatch,now)!;assert.ok(normalizeEodhdQuarterly(mixed,10,now).every(q=>q.numeric.operatingCF===null));
});
test('ETF holdings use actual weights and symbols without assigning a sector from aggregate fund weights',()=>{
 const p=profile('SPY','ETF');p.topHoldings={holdings:[{symbol:'DEMO',holdingName:'Example',holdingPercent:{raw:.05}},{symbol:'EURO.PA',holdingPercent:{raw:.1}}],sectorWeightings:[{technology:{raw:.4}}]};
 const raw=stockRadarRawFromYahoo('SPY',p,null,now)!;assert.equal(Object.keys(raw.ETF_Data.Holdings).length,1);assert.equal(raw.ETF_Data.Holdings['DEMO.US']['Assets_%'],5);assert.equal(raw.ETF_Data.Holdings['DEMO.US'].Sector,'');assert.equal(raw._radarFallback.holdingsPublicationDate,null);
});
test('FMP adapter joins only exact quarterly dates and filing dates, never annual or neighboring statements',()=>{
 const raw=stockRadarRawFromFmp('DEMO',fmpProfile,fmpRows(),fmpRows(true),[],now,fmpQuote)!;assert.equal(normalizeEodhdQuarterly(raw,10,now)[0].numeric.freeCashFlow,25e6);assert.equal(raw.General.UpdatedAt,'2026-11-02');
 const annual=fmpRows(true).map(q=>({...q,period:'FY'})),neighbor=fmpRows(true).map(q=>({...q,date:new Date(Date.parse(q.date)-86400000).toISOString().slice(0,10)}));for(const cf of [annual,neighbor])assert.ok(normalizeEodhdQuarterly(stockRadarRawFromFmp('DEMO',fmpProfile,fmpRows(),cf,[],now,fmpQuote)!,10,now).every(q=>q.numeric.operatingCF===null));
 const future=fmpRows().map(q=>({...q,filingDate:'2027-01-01'}));assert.equal(normalizeEodhdQuarterly(stockRadarRawFromFmp('DEMO',fmpProfile,future,fmpRows(true),[],now,fmpQuote)!,10,now).length,0);assert.equal(stockRadarRawFromFmp('DEMO',fmpProfile,fmpRows(),fmpRows(true),[],now),null);
});
test('factory shares duplicate reads and never tries paid statements when published quarterly data is sufficient',async()=>{
 let summaries=0,series=0,paid=0;const fallback=createStockRadarFallback({now,summary:async()=>{summaries++;return profile();},timeseries:async()=>{series++;return timeseries();},fmpRead:async()=>{paid++;return null;}});const [a,b]=await Promise.all([fallback.fundamentals('DEMO'),fallback.fundamentals('DEMO')]);assert.equal(a,b);assert.equal(summaries,1);assert.equal(series,1);assert.equal(paid,0);
});
test('optional raw FMP reader is used only after missing statements, with bounded quarter-only requests',async()=>{
 const calls:string[]=[];const fallback=createStockRadarFallback({now,summary:async()=>null,timeseries:async()=>null,fmpRead:async(path,query)=>{calls.push(path);assert.equal(query.symbol,'DEMO');if(path==='profile')return[fmpProfile];if(path==='quote')return[fmpQuote];assert.equal(query.period,'quarter');assert.equal(query.limit,8);return fmpRows(path==='cash-flow-statement');}});
 const value=await fallback.fundamentals('DEMO');assert.ok(value);assert.equal(normalizeEodhdQuarterly(value,10,now).length,5);assert.deepEqual(calls.sort(),['cash-flow-statement','income-statement','profile','quote']);
});
test('history fallback preserves actual adjusted closes and currencies, without forward fill or synthetic volume',()=>{
 const raw={symbol:'DEMO',kind:'stock' as const,currency:'USD',dates:['2026-10-30','2026-11-02'],closes:[50,55],raw:[100,55],volumes:[null,0]};const h=stockRadarHistoryFromRelative('DEMO','USD',raw,now)!;assert.equal(h.points[0].close,100);assert.equal(h.points[0].adjustedClose,50);assert.equal(h.points[0].volume,null);assert.equal(h.points[1].volume,0);assert.equal(stockRadarHistoryFromRelative('DEMO','EUR',raw,now),null);
});
test('reactivated primary fundamentals take precedence, while stale primary statements use the enabled fallback without relaxing criteria',async()=>{
 let alternativeReads=0;const base=stockRadarRawFromYahoo('DEMO',profile(),timeseries(),now)!,fund=stockRadarRawFromYahoo('SPY',{...profile('SPY','ETF'),topHoldings:{holdings:[{symbol:'DEMO',sector:'Technology',holdingPercent:{raw:.1}}]}},null,now)!;
 const fakeHistory={symbol:'DEMO',currency:'USD',points:Array.from({length:250},(_,i)=>({date:new Date(Date.parse('2026-02-23')+i*86400000).toISOString().slice(0,10),close:100+i,adjustedClose:100+i,volume:1000000})).filter(p=>p.date<='2026-11-02')};
 const load=(stale:boolean)=>loadStockResearchRadar({now,request:async()=>({data:[{code:'DEMO',sector:'Technology',exchange:'US',last_day_data_date:'2026-11-02',market_capitalization:5e9,earnings_share:1,avgvol_200d:1e6,adjusted_close:100}]} as any),fundamentals:async symbol=>symbol==='DEMO'?{...base,General:{...base.General,UpdatedAt:stale?'2025-01-01':'2026-11-02'}}:fund,history:async symbol=>({...fakeHistory,symbol}),fallback:{fundamentals:async()=>{alternativeReads++;return base;}}});
 await load(false);assert.equal(alternativeReads,0);await load(true);assert.equal(alternativeReads,1);
});

test('one unavailable broad-fund probe prevents repeated entitlement failures only for this build and is retried next refresh',async()=>{
 const primary:string[]=[],alternatives:string[]=[];let enabled=false;
 const load=()=>loadStockResearchRadar({now,request:async()=>null,fundamentals:async symbol=>{primary.push(symbol);return enabled?{General:{Code:symbol,Type:'ETF',UpdatedAt:'2026-11-02'},ETF_Data:{Holdings:{'DEMO.US':{Code:'DEMO',Exchange:'US',Sector:'Technology','Assets_%':5}}}}:null;},fallback:{fundamentals:async symbol=>{alternatives.push(symbol);return null;}}});
 await load();assert.deepEqual(primary,['SPY']);assert.equal(alternatives.length,10);
 enabled=true;primary.length=0;await load();assert.equal(primary[0],'SPY');assert.ok(primary.length>1,'The next build retries the primary capability rather than disabling it permanently');
});
