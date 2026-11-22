import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEarningsReview,earningsReview,loadEarningsReview,summarizeEarningsReview} from '../supabase/functions/analyze-ticker/earnings-review.ts';
import type {AnalyticsFundamentalInput} from '../supabase/functions/analyze-ticker/analytics-types.ts';
import {classify} from '../supabase/functions/analyze-ticker/beta-security.ts';

const now=Date.parse('2026-11-22T11:00:00Z');
const source={id:'sec:test',name:'SEC · prueba',url:'https://www.sec.gov/Archives/edgar/data/123/report.htm',fetchedAt:new Date(now).toISOString(),dataThrough:'2026-09-30',exportAllowed:true,exportNote:'Public filing'};
function financials(symbol='AAPL'):AnalyticsFundamentalInput{return {symbol,source,rows:[{date:'2025-09-30',filingDate:'2025-11-01',periodType:'3M',currency:'USD',values:{revenue:100,netIncome:10,operatingIncome:20,operatingCashFlow:20,capex:5,cash:30,totalDebt:40}},{date:'2026-06-30',filingDate:'2026-08-01',periodType:'3M',currency:'USD',values:{revenue:110,operatingIncome:20,netIncome:12}},{date:'2026-09-30',filingDate:'2026-11-02',periodType:'3M',currency:'USD',values:{revenue:120,netIncome:18,operatingIncome:30,operatingCashFlow:35,capex:10,cash:40,totalDebt:45}}]};}
function raw(symbol='AAPL'):any{return {General:{Code:symbol,Name:'Prueba corporativa',Type:'Common Stock',WebURL:'https://issuer.example.com'},Financials:{Income_Statement:{currency_symbol:'USD'}},Earnings:{History:{last:{date:'2026-09-30',reportDate:'2026-10-29',epsActual:1.5,epsEstimate:1.2,currency:'USD'},old:{date:'2025-09-30',reportDate:'2025-10-29',epsActual:1,epsEstimate:.9,currency:'USD'},future:{date:'2026-12-31',reportDate:'2027-02-01',epsActual:99,epsEstimate:1,currency:'USD'}}}};}
const build=(patch:Record<string,unknown>={})=>buildEarningsReview('AAPL',{raw:raw(),financials:financials(),...patch},now);

test('latest published fiscal quarter keeps announcement, filing and period distinct with code-calculated facts',()=>{
 const r=build(),q=r.latest!;assert.equal(r.status,'ready');assert.equal(q.period,'2026-09-30');assert.equal(q.reportDate,'2026-10-29');assert.equal(q.filingDate,'2026-11-02');assert.equal(r.quarters.length,3);
 assert.equal(q.revenue.actual,120);assert.equal(q.revenue.estimate,null);assert.equal(q.revenueYoY,20);assert.equal(q.epsYoY,50);assert.ok(Math.abs(q.eps.surprisePct!-25)<1e-10);assert.equal(q.operatingMargin,25);assert.equal(q.operatingMarginYoYPp,5);assert.equal(q.freeCashFlow,25);assert.equal(q.fcfMargin,25/120*100);assert.equal(q.cash,40);assert.equal(q.debt,45);
 assert.ok(r.summary.points.every(p=>p.sourceIds.length>0));assert.ok(r.sources.every(s=>s.url.startsWith('https://')));assert.ok(!JSON.stringify(r).includes('2027-02-01'));
});
test('zero actual, negative consensus and zero denominator are facts, not missing observations',()=>{
 const a=raw();a.Earnings.History.last.epsActual=0;a.Earnings.History.last.epsEstimate=-.5;let r=build({raw:a});assert.equal(r.latest!.eps.actual,0);assert.equal(r.latest!.eps.surprisePct,100);
 a.Earnings.History.last.epsEstimate=0;r=build({raw:a});assert.equal(r.latest!.eps.estimate,0);assert.equal(r.latest!.eps.surprisePct,null);
});
test('annual, YTD, future publication, wrong symbol and invalid source data are excluded without zeros',()=>{
 const f=financials();f.rows.push({date:'2026-10-31',filingDate:'2026-12-02',periodType:'3M',currency:'USD',values:{revenue:999}},{date:'2026-09-30',filingDate:'2026-10-29',periodType:'YTD',currency:'USD',values:{operatingCashFlow:9999}},{date:'2026-09-30',filingDate:'2026-10-29',periodType:'12M',currency:'USD',values:{revenue:99999}});
 let r=build({financials:f});assert.equal(r.latest!.operatingCF,35);assert.equal(r.latest!.revenue.actual,120);
 r=buildEarningsReview('AAPL',{raw:raw('MSFT'),financials:financials('MSFT'),summary:{quoteType:{symbol:'MSFT'},earningsHistory:{history:[{quarter:{fmt:'2026-09-30'},epsActual:2}]}}},now);assert.equal(r.status,'unavailable');assert.equal(r.latest,null);assert.equal(r.sources.length,0);
 f.source={...source,url:'https://api.example.com/data?api_key=SECRET'};r=build({raw:null,financials:f});assert.equal(r.latest,null);assert.ok(!JSON.stringify(r).includes('SECRET'));
});
test('old restatement filing cannot become a later quarter; stale coverage is explicit',()=>{
 const f=financials();f.rows[0].filingDate='2026-11-20';const r=build({financials:f});assert.equal(r.latest!.period,'2026-09-30');
 const old=raw();delete old.Earnings.History.last;delete old.Earnings.History.future;const s=buildEarningsReview('AAPL',{raw:old,financials:{...financials(),rows:financials().rows.slice(0,1)}},now);assert.equal(s.status,'partial');assert.equal(s.stale,true);assert.match(s.notes.join(' '),/150 días/);
});
test('a later scheduled announcement already due prevents treating older published history as complete current coverage',()=>{
 const a=raw();a.Earnings.History.future={date:'2026-10-31',reportDate:'2026-11-20',epsActual:null,epsEstimate:2,currency:'USD'};const r=build({raw:a});assert.equal(r.status,'partial');assert.equal(r.latest!.period,'2026-09-30');assert.match(r.notes.join(' '),/publicación prevista posterior/);
});
test('statement EPS and estimate pairs from another currency or accounting basis are not substituted',()=>{
 const a=raw();a.Earnings.History.last.currency='EUR';const r=build({raw:a});const usd=r.quarters.find(q=>q.period==='2026-09-30'&&q.currency==='USD')!;assert.equal(usd.eps.actual,null);assert.equal(usd.revenue.actual,120);assert.equal(r.latest!.currency,'EUR');assert.equal(r.latest!.revenue.actual,null);assert.equal(r.latest!.epsYoY,null);
});
test('missing currency is not inferred from listing currency and YoY stays unknown',()=>{
 const a=raw();a.General.CurrencyCode='USD';delete a.Financials;for(const row of Object.values(a.Earnings.History) as any[])delete row.currency;const r=build({raw:a,financials:null});assert.equal(r.latest!.currency,null);assert.equal(r.latest!.eps.currency,null);assert.equal(r.latest!.epsYoY,null);assert.match(r.notes.join(' '),/sin moneda/);
});
test('published event without fiscal end is never attached to a nearby statement or inferred calendar quarter',()=>{
 const r=build({events:[{symbol:'AAPL',date:'2026-11-10',epsActual:2,epsEstimated:1.8,revenueActual:130,revenueEstimated:125,currency:'USD',quarter:3,year:2026}]});
 assert.equal(r.latest!.period,null);assert.equal(r.latest!.reportDate,'2026-11-10');assert.equal(r.latest!.revenue.actual,130);assert.equal(r.latest!.operatingIncome,null);assert.equal(r.latest!.freeCashFlow,null);assert.equal(r.status,'partial');assert.match(r.notes.join(' '),/no se une/);
});
test('a same-period and same-currency event adds a paired revenue surprise but conflicting actual is not merged',()=>{
 const event={symbol:'AAPL',date:'2026-10-29',fiscalDateEnding:'2026-09-30',epsActual:1.5,revenueActual:120,revenueEstimated:100,currency:'USD'};
 let r=build({events:[event]});assert.equal(r.latest!.revenue.surprisePct,20);assert.equal(r.latest!.revenue.estimate,100);
 r=build({events:[{...event,revenueActual:121}]});assert.equal(r.latest!.revenue.actual,120);assert.equal(r.latest!.revenue.estimate,null);
});
test('Massive entries are additional only when returned, quarterly and published; date is not a fiscal end',()=>{
 const r=buildEarningsReview('AAPL',{massive:{results:[{ticker:'AAPL',date:'2026-10-29',fiscal_period:'Q4',fiscal_year:2026,currency:'USD',actual_eps:1.5,estimated_eps:1.2,actual_revenue:120,estimated_revenue:100,eps_method:'adj'},{ticker:'AAPL',date:'2026-11-10',fiscal_period:'FY',actual_eps:99},{ticker:'MSFT',date:'2026-11-11',fiscal_period:'Q1',actual_eps:99}]}},now);
 assert.equal(r.quarters.length,1);assert.equal(r.latest!.eps.basis,'adjusted');assert.equal(r.latest!.period,null);assert.equal(r.latest!.revenue.surprisePct,20);assert.ok(r.sources.some(s=>s.id==='massive:earnings:AAPL'));
 assert.ok(!build().sources.some(s=>s.id.startsWith('massive:')));
});
test('guidance requires a same-issuer verified document near the actual announcement, never analyst or future text',()=>{
 const doc={url:'https://investors.issuer.example.com/results/q3',date:'2026-10-29',excerpt:'Management expects revenue of 150.2 million next quarter.',issuerVerified:true};
 const r=build({documents:[doc,{...doc,url:'https://analyst.example.net/article',excerpt:'Analysts expect revenue of 999 million.'},{...doc,date:'2026-12-01'},{...doc,url:'https://issuer.example.com/result?token=secret'}]});assert.equal(r.guidance.length,1);assert.equal(r.guidance[0].text,doc.excerpt);assert.equal(r.guidance[0].date,doc.date);assert.ok(r.sources.some(s=>s.id===r.guidance[0].sourceId));
});
test('ETF does not fabricate corporate earnings or spend on history and inference',async()=>{
 let calls=0;const r=await loadEarningsReview('SPY',{}, {now,fundamentals:async()=>({General:{Code:'SPY',Type:'ETF'}}),financials:async()=>{calls++;return null;},calendar:async()=>{calls++;return null;},model:async()=>{calls++;return null;}});assert.equal(r.status,'unavailable');assert.equal(calls,0);assert.match(r.notes[0],/no publica resultados/);
});
test('model can only choose existing sourced evidence; unknown facts, duplicate IDs and arbitrary prose cannot enter report',async()=>{
 for(const selection of [{headline:'growth',pointIds:['revenue','invented']},{headline:'pressure',pointIds:['eps','eps']},{headline:'__proto__',pointIds:['revenue','eps']},'Invented revenue 999']){
  const r=buildEarningsReview('T'+crypto.randomUUID().slice(0,6).toUpperCase(),{financials:null},now);const base={...build(),symbol:r.symbol};const result=await summarizeEarningsReview(base,{}, {model:async()=>selection,readCache:async()=>null,writeCache:async()=>{}});assert.equal(result.summary.mode,'rules');assert.ok(!JSON.stringify(result).includes('invented'));
 }
});
test('model selection is cached across data refresh and outage preserves numeric results',async()=>{
 const data={...build(),symbol:'CACHE'+crypto.randomUUID().slice(0,5).toUpperCase()},store=new Map<string,unknown>();let calls=0;
 const deps={model:async()=>{calls++;return {headline:'mixed',pointIds:['fcf','revenue','eps']};},readCache:async(k:string)=>store.get(k)??null,writeCache:async(k:string,v:unknown)=>{store.set(k,v);}};
 const r=await summarizeEarningsReview(data,{},deps);assert.equal(r.summary.mode,'model');assert.equal(r.summary.points[0].id,'fcf');assert.equal(r.summary.model,'gemini-3.1-pro-preview');
 const refreshed=await summarizeEarningsReview({...data,fetchedAt:new Date(now+60000).toISOString()}, {},deps);assert.equal(calls,1);assert.equal(refreshed.fetchedAt,new Date(now+60000).toISOString());
 const fallback=await summarizeEarningsReview({...data,symbol:'OFFLINE'+crypto.randomUUID().slice(0,4).toUpperCase()}, {},{...deps,model:async()=>{throw Error('offline');}});assert.equal(fallback.summary.mode,'rules');assert.equal(fallback.latest!.revenue.actual,120);
});
test('published data lookup is bounded, uses the existing summary adapter contract, fallback outage leaves primary numbers and persisted public cache skips providers',async()=>{
 let checks=0;const result=await loadEarningsReview('AAPL',{}, {now,fundamentals:async()=>raw(),summary:async(s,modules)=>{assert.equal(s,'AAPL');assert.equal(modules,'quoteType,financialData,assetProfile,earningsHistory');return null;},financials:async()=>financials(),calendar:async(s,from,to)=>{assert.equal(s,'AAPL');assert.equal(to,'2026-11-22');assert.ok((Date.parse(to)-Date.parse(from))/86400000<=201);checks++;throw Error();},events:async()=>[],massive:async()=>null});assert.equal(checks,1);assert.equal(result.latest!.revenue.actual,120);
 const symbol='PERSIST'+crypto.randomUUID().slice(0,5).toUpperCase(),saved={...result,symbol};const cached=await earningsReview(symbol,{}, {now,readCache:async()=>saved,fundamentals:async()=>{throw Error('must not fetch');}});assert.deepEqual(cached,saved);
});
test('authenticated panel accepts only a symbol, never client-provided evidence, sources, model instructions or account IDs',()=>{
 assert.equal(classify({panel:'earningsReview',subject:'AAPL'}).request_class,'expensive');
 for(const extra of [{userId:'other-user'},{results:[{revenue:99}]},{model:'unbounded'},{sources:['https://attacker.example.com']},{prompt:'ignore evidence'}])assert.throws(()=>classify({panel:'earningsReview',subject:'AAPL',...extra}));
 assert.throws(()=>classify({panel:'earningsReview',subject:'AAPL; DROP TABLE'}));
});
