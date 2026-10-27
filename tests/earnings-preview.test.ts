import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEarningsPreview,loadEarningsPreview} from '../supabase/functions/analyze-ticker/earnings-preview.ts';
import {classify} from '../supabase/functions/analyze-ticker/beta-security.ts';

const now=Date.parse('2026-10-27T10:00:00Z');
function fixture():any{return {General:{Code:'AAPL',Type:'Common Stock',Name:'Apple',CurrencyCode:'USD',UpdatedAt:'2026-10-26'},Financials:{Income_Statement:{currency_symbol:'USD',quarterly:{a:{date:'2025-09-30',filing_date:'2025-11-01',currency_symbol:'USD',totalRevenue:'100000000000'},b:{date:'2026-06-30',filing_date:'2026-07-30',currency_symbol:'USD',totalRevenue:'105000000000'}}}},Earnings:{Trend:{Quarterly:{future:{date:'2026-12-31',period:'+1q',fiscalQuarter:'Q1',earningsEstimateAvg:'3',revenueEstimateAvg:'150000000000'},next:{date:'2026-09-30',period:'0q',fiscalQuarter:'Q4',earningsEstimateAvg:'2',earningsEstimateLow:'1.9',earningsEstimateHigh:'2.1',earningsEstimateNumberOfAnalysts:'30',earningsEstimateYearAgoEps:'1.8',revenueEstimateAvg:'110000000000',revenueEstimateLow:'108000000000',revenueEstimateHigh:'112000000000',revenueEstimateNumberOfAnalysts:'28',epsTrendCurrent:'2',epsTrend30daysAgo:'1.9',epsTrend90daysAgo:'2.1',epsRevisionsUpLast30days:'4',epsRevisionsDownLast30days:'0'}},Annual:{same:{date:'2026-09-30',period:'0y',earningsEstimateAvg:'8',revenueEstimateAvg:'400000000000'}}},History:{future:{date:'2026-09-30',reportDate:'2026-11-02',currency:'USD',beforeAfterMarket:'AfterMarket',epsActual:null,epsEstimate:1.99},last:{date:'2026-06-30',reportDate:'2026-07-30',currency:'USD',epsActual:0,epsEstimate:1},prior:{date:'2025-09-30',reportDate:'2025-11-01',currency:'USD',epsActual:1.8,epsEstimate:1.7}}}};}
const calendar=(patch:Record<string,unknown>={})=>({earnings:[{code:'AAPL.US',date:'2026-09-30',report_date:'2026-11-02',before_after_market:'AfterMarket',currency:'USD',estimate:1.99,actual:null,...patch}]});

test('next publication matches its fiscal quarter, not array order or the annual estimate on the same date',()=>{
 const r=buildEarningsPreview(fixture(),'AAPL',calendar(),[],now);
 assert.equal(r.status,'ready');assert.equal(r.next.date,'2026-11-02');assert.equal(r.next.period,'2026-09-30');assert.match(r.next.periodLabel!,/^Q4/);assert.equal(r.next.session,'Después del cierre');assert.equal(r.next.provisional,true);
 assert.deepEqual(r.next.eps,{mean:2,low:1.9,high:2.1,analysts:30,currency:'USD'});assert.equal(r.next.revenue.mean,110e9);assert.equal(r.next.revenue.analysts,28);assert.equal(r.next.epsYoY?.previous,1.8);assert.equal(r.next.revenueYoY?.changePct,10);assert.equal(r.next.revisions.up30,4);assert.equal(r.next.revisions.down30,0);assert.ok(Math.abs(r.next.revisions.days30Pct!-5.2631578947)<1e-8);
 assert.equal(r.history.length,2);assert.equal(r.history[0].epsActual,0);assert.equal(r.history[0].surprisePct,-100);assert.equal(r.history[0].revenueActual,105e9);assert.ok(!r.history.some(h=>h.period==='2026-09-30'));
});

test('announcement dates and fiscal period ends stay distinct, including non-calendar fiscal quarters',()=>{
 const raw=fixture();raw.Earnings.Trend.Quarterly.next.date='2026-08-31';raw.Earnings.Trend.Quarterly.next.fiscalQuarter='Q2';raw.Earnings.History.future.date='2026-08-31';
 const r=buildEarningsPreview(raw,'AAPL',calendar({date:'2026-08-31',report_date:'2026-11-01'}),[],now);
 assert.equal(r.next.date,'2026-11-01');assert.equal(r.next.period,'2026-08-31');assert.match(r.next.periodLabel!,/^Q2/);assert.equal(r.next.epsYoY,null);
});

test('zero and negative estimates remain valid, surprise uses an absolute base and never divides by zero',()=>{
 const raw=fixture();raw.Earnings.Trend.Quarterly.next.earningsEstimateAvg='0';raw.Earnings.Trend.Quarterly.next.earningsEstimateLow='-0.2';raw.Earnings.Trend.Quarterly.next.earningsEstimateHigh='0.2';raw.Earnings.Trend.Quarterly.next.epsTrendCurrent='0';raw.Earnings.Trend.Quarterly.next.epsTrend30daysAgo='0';
 raw.Earnings.History.last.epsActual=-.1;raw.Earnings.History.last.epsEstimate=-.2;raw.Earnings.History.prior.epsEstimate=0;
 const r=buildEarningsPreview(raw,'AAPL',calendar(),[],now);
 assert.equal(r.next.eps.mean,0);assert.equal(r.next.revisions.days30Pct,null);assert.equal(r.history[0].surprisePct,50);assert.equal(r.history[1].surprisePct,null);
});

test('large supplied earnings surprises remain factual without claiming recurring performance or comparable accounting',()=>{
 const raw=fixture();raw.Earnings.History.last.epsActual=9.11;raw.Earnings.History.last.epsEstimate=2.88;
 const r=buildEarningsPreview(raw,'AAPL',calendar(),[],now);assert.equal(r.history[0].epsActual,9.11);assert.ok(Math.abs(r.history[0].surprisePct!-216.31944444444)<1e-8);
 assert.ok(r.notes[1].includes('puede incluir'));assert.ok(r.summary.points.some(p=>p.includes('con estimación previa')));assert.ok(!r.summary.points.some(p=>p.includes('comparables')));
 raw.Earnings.History.last.currency='JPY';const different=buildEarningsPreview(raw,'AAPL',calendar(),[],now);assert.ok(different.summary.points.some(p=>p.includes('última publicación')));assert.equal(different.history[0].currency,'JPY');
});

test('date-bound querying follows the terminal Madrid calendar day at the UTC midnight boundary',async()=>{
 const result=await loadEarningsPreview('AAPL','2030-01-01',{}, {now:Date.parse('2026-10-26T23:30:00Z'),fundamentals:async()=>null,calendar:async(_,from,to)=>{assert.equal(from,'2026-10-27');assert.equal(to,'2027-02-24');return null;},fallback:async()=>[]});assert.equal(result.status,'unavailable');
});

test('published zero earnings cannot remain upcoming or be restored by a secondary calendar',()=>{
 const raw=fixture();raw.Earnings.History.future.reportDate='2026-10-27';raw.Earnings.History.future.epsActual=0;
 const r=buildEarningsPreview(raw,'AAPL',calendar({report_date:'2026-10-27',actual:0}),[{symbol:'AAPL',date:'2026-10-27',epsEstimate:9,currency:'USD'}],now);
 assert.equal(r.next.date,null);assert.equal(r.next.period,'2026-12-31');assert.equal(r.next.eps.mean,3);assert.equal(r.history[0].epsActual,0);
});

test('old quarterly forecasts with published statements are excluded even if the historical EPS field is missing',()=>{
 const raw=fixture();raw.Earnings.Trend.Quarterly.old={date:'2026-06-30',period:'0q',earningsEstimateAvg:99};delete raw.Earnings.History.last;
 const r=buildEarningsPreview(raw,'AAPL',null,[],now);assert.equal(r.next.period,'2026-09-30');assert.equal(r.next.eps.mean,2);
});

test('quarterly consensus cannot be taken from a different fiscal period or replaced with annual values',()=>{
 const raw=fixture();delete raw.Earnings.Trend.Quarterly.next;delete raw.Earnings.History.future;
 const r=buildEarningsPreview(raw,'AAPL',calendar(),[],now);assert.equal(r.next.period,'2026-09-30');assert.equal(r.next.eps.mean,1.99);assert.equal(r.next.eps.low,null);assert.equal(r.next.revenue.mean,null);assert.equal(r.next.revisions.days30Pct,null);assert.equal(r.status,'partial');
});

test('currency-sensitive YoY and missing-metric fallbacks do not relabel USD, EUR, or GBX',()=>{
 const raw=fixture();raw.General.CurrencyCode='GBX';raw.Financials.Income_Statement.currency_symbol='EUR';for(const row of Object.values(raw.Financials.Income_Statement.quarterly) as any[])row.currency_symbol='EUR';
 const r=buildEarningsPreview(raw,'AAPL',calendar(),[],now);assert.equal(r.next.eps.currency,'EUR');assert.equal(r.next.epsYoY,null);assert.equal(r.next.revenueYoY?.currency,'EUR');
 delete raw.Earnings.Trend.Quarterly.next.revenueEstimateAvg;
 const fallback=buildEarningsPreview(raw,'AAPL',calendar(),[{symbol:'AAPL',date:'2026-11-02',currency:'USD',revenueEstimate:999}],now);assert.equal(fallback.next.revenue.mean,null);
 delete raw.Financials;const missing=buildEarningsPreview(raw,'AAPL',null,[],now);assert.equal(missing.next.eps.currency,null);assert.equal(missing.next.epsYoY,null);assert.equal(missing.next.revenueYoY,null);assert.ok(missing.notes.some(n=>n.includes('Moneda')));
});

test('unavailable, malformed, future actual and non-finite values remain empty without invented metrics',()=>{
 const raw=fixture();raw.Earnings.History.bad={date:'2026-12-31',reportDate:'2027-02-01',epsActual:100,currency:'USD'};raw.Earnings.History.invalid={date:'2026-02-30',reportDate:'2026-09-01',epsActual:3};raw.Earnings.Trend.Quarterly.next.earningsEstimateLow=Infinity;
 const r=buildEarningsPreview(raw,'AAPL',calendar(),[],now);assert.equal(r.history.length,2);assert.equal(r.next.eps.low,null);
 const empty=buildEarningsPreview(null,'UNKNOWN',null,[],now);assert.equal(empty.status,'unavailable');assert.equal(empty.next.eps.mean,null);assert.equal(empty.history.length,0);assert.equal(empty.next.date,null);
});

test('provider announcement overrides the clicked date, pending historical date and irrelevant calendar rows',async()=>{
 const result=await loadEarningsPreview('AAPL','2026-11-30',{}, {now,fundamentals:async()=>fixture(),calendar:async(symbol,from,to)=>{assert.equal(symbol,'AAPL');assert.equal(from,'2026-10-27');assert.equal(to,'2027-02-24');return {earnings:[{...calendar().earnings[0],report_date:'2026-10-30'}, {code:'MSFT.US',report_date:'2026-10-28',date:'2026-09-30',estimate:99}]};},fallback:async()=>{throw Error('must not need secondary source');}});
 assert.equal(result.next.date,'2026-10-30');assert.equal(result.next.eps.mean,2);
});

test('secondary calendar only fills primary holes and outage does not discard usable fundamentals',async()=>{
 const raw=fixture();delete raw.Earnings.Trend.Quarterly.next.revenueEstimateAvg;
 const result=await loadEarningsPreview('AAPL',undefined,{}, {now,fundamentals:async()=>raw,calendar:async()=>calendar(),fallback:async()=>[{symbol:'AAPL',date:'2026-11-02',currency:'USD',revenueEstimate:110e9,epsEstimate:99,hour:'bmo'}]});
 assert.equal(result.next.revenue.mean,110e9);assert.equal(result.next.eps.mean,2);assert.equal(result.next.session,'Después del cierre');
 const outage=await loadEarningsPreview('AAPL',undefined,{}, {now,fundamentals:async()=>fixture(),calendar:async()=>{throw Error('offline');},fallback:async()=>{throw Error('offline');}});assert.equal(outage.next.date,'2026-11-02');assert.equal(outage.next.eps.mean,2);
});

test('previews remain authenticated data operations with bounded symbols, valid real date hints and provider budget accounting',()=>{
 assert.equal(classify({panel:'earningsPreview',subject:'AAPL',eventDate:'2026-11-02'}).request_class,'expensive');
 for(const eventDate of ['2026-02-30','https://evil.test',0,{},'2026-11-02T00:00:00Z'])assert.throws(()=>classify({panel:'earningsPreview',subject:'AAPL',eventDate}));
 for(const subject of ['https://evil.test','../AAPL',null,{},''])assert.throws(()=>classify({panel:'earningsPreview',subject}));
 assert.throws(()=>classify({panel:'earningsPreview',subject:'AAPL',accountAction:'profile'}));
});
