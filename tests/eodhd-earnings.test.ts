import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeEodhdEarnings,mergeEarningsCalendar,loadEarningsCalendar} from '../supabase/functions/analyze-ticker/feed-extras.ts';
const start='2026-10-21',end='2026-10-27';
const calendar=(earnings:unknown[])=>({type:'Earnings',from:start,to:end,earnings});
const event=(patch:Record<string,unknown>={})=>({code:'AAPL.US',report_date:'2026-10-23',date:'2026-09-30',before_after_market:'AfterMarket',currency:'USD',estimate:2.4,actual:null,difference:0,...patch});

test('EODHD uses announcement date for the next seven days and retains fiscal date and EPS currency separately',()=>{
 const rows=normalizeEodhdEarnings(calendar([event(),event({code:'MSFT.US',report_date:'2026-10-28'}),event({code:'NVDA.US',report_date:'2026-10-20'}),event({code:'AMZN.US',report_date:null}),event({code:'META.US',report_date:'2026-02-30'})]),start,end);
 assert.equal(rows.length,1);assert.equal(rows[0].date,'2026-10-23');assert.equal(rows[0].fiscalDate,'2026-09-30');assert.equal(rows[0].eps,2.4);assert.equal(rows[0].currency,'USD');assert.equal(rows[0].session,'Después del cierre');assert.equal(rows[0].revenue,null);
});

test('only known listing suffixes become clickable symbols; unsupported listings are not silently changed to US stocks',()=>{
 const rows=normalizeEodhdEarnings(calendar(['AAPL.US','SAP.XETRA','ASML.AS','VOD.LSE','TYZ.STU','../AAPL.US'].map(code=>event({code}))),start,end);
 assert.deepEqual(rows.map(row=>row.symbol),['AAPL','SAP.DE','ASML.AS','VOD.L']);
});

test('missing EPS is unavailable despite a zero difference; actual EPS does not replace an estimate',()=>{
 const rows=normalizeEodhdEarnings(calendar([event({estimate:null,actual:null,difference:0,before_after_market:null})]),start,end);
 assert.equal(rows[0].eps,null);assert.equal(rows[0].session,'Hora por confirmar');assert.equal(rows[0].fiscalDate,'2026-09-30');
});

test('primary dates, session and estimates win while legacy sources only fill missing rows and metrics',()=>{
 const primary=normalizeEodhdEarnings(calendar([event(),event({code:'ZERO.US',estimate:0,before_after_market:null})]),start,end);
 const rows=mergeEarningsCalendar(primary,[{symbol:'AAPL',date:'2026-10-23',epsEstimate:99,revenueEstimate:9e9,hour:'bmo',currency:'USD'},{symbol:'ZERO',date:'2026-10-23',epsEstimate:4,revenueEstimate:1e9,hour:'bmo',currency:'USD'},{symbol:'MSFT',date:'2026-10-24',epsEstimate:3,revenueEstimate:6e9,hour:'amc'},{symbol:'BAD',date:'2026-11-01'}],start,end);
 const apple=rows.find(row=>row.symbol==='AAPL')!,zero=rows.find(row=>row.symbol==='ZERO')!;
 assert.equal(apple.eps,2.4);assert.equal(apple.session,'Después del cierre');assert.equal(apple.revenue,9e9);assert.equal(zero.eps,0);assert.equal(zero.session,'Antes de apertura');assert.ok(rows.some(row=>row.symbol==='MSFT'));assert.ok(!rows.some(row=>row.symbol==='BAD'));
});

test('EPS fallback cannot relabel another currency and calendar ranking remains deterministic without revenue estimates',()=>{
 const primary=normalizeEodhdEarnings(calendar([event({estimate:null,currency:'EUR'}),event({code:'ZERO.US',estimate:null,currency:'USD'})]),start,end);
 const rows=mergeEarningsCalendar(primary,[{symbol:'AAPL',date:'2026-10-23',epsEstimate:4,currency:'USD'},{symbol:'ZERO',date:'2026-10-23',epsEstimate:1}],start,end);
 assert.equal(rows[0].symbol,'AAPL');assert.equal(rows[0].eps,null);assert.equal(rows[0].currency,'EUR');assert.equal(rows[1].eps,1);assert.equal(rows[1].currency,null);
});

test('calendar retains at most four events per day ordered by supplied revenue and stays within the seven-day window',()=>{
 const fallback=Array.from({length:7},(_,day)=>Array.from({length:5},(_,i)=>({symbol:'TEST'+i,date:`2026-10-${21+day}`,revenueEstimate:i*100}))).flat();
 const rows=mergeEarningsCalendar([],fallback,start,end);assert.equal(rows.length,24);assert.equal(rows[0].symbol,'TEST4');assert.ok(rows.every(row=>row.date>=start&&row.date<=end));for(const day of new Set(rows.map(row=>row.date)))assert.ok(rows.filter(row=>row.date===day).length<=4);
});

test('calendar loads EODHD first and supplements holes with existing credentials, using the Madrid calendar day',async()=>{
 const calls:string[]=[];const rows=await loadEarningsCalendar('','',{now:Date.parse('2026-10-20T22:30:00Z'),primary:async(from,to)=>{calls.push('primary');assert.equal(from,start);assert.equal(to,end);return calendar([event()]);},fallback:async()=>{calls.push('fallback');return [{symbol:'AAPL',date:'2026-10-23',revenueEstimate:4e9}];}});
 assert.deepEqual(calls,['primary','fallback']);assert.equal(rows.length,1);assert.equal(rows[0].revenue,4e9);
});

test('calendar survives a failure of either source without discarding the other valid calendar',async()=>{
 const now=Date.parse('2026-10-21T10:00:00Z');
 const fallback=await loadEarningsCalendar('','',{now,primary:async()=>{throw Error('Denied');},fallback:async()=>[{symbol:'AAPL',date:'2026-10-23',epsEstimate:2}]});assert.equal(fallback[0].eps,2);
 const primary=await loadEarningsCalendar('','',{now,primary:async()=>calendar([event()]),fallback:async()=>{throw Error('Offline');}});assert.equal(primary[0].eps,2.4);
});

test('published results including zero actual EPS cannot reappear through another calendar source',async()=>{
 const primary=calendar([event({actual:0}),event({code:'MSFT.US',actual:3}),event({code:'META.US',actual:null})]);
 assert.deepEqual(normalizeEodhdEarnings(primary,start,end).map(row=>row.symbol),['META']);
 const rows=await loadEarningsCalendar('','',{now:Date.parse('2026-10-21T10:00:00Z'),primary:async()=>primary,fallback:async()=>[{symbol:'AAPL',date:'2026-10-23',epsEstimate:7},{symbol:'MSFT',date:'2026-10-23',epsEstimate:8},{symbol:'META',date:'2026-10-23',epsEstimate:9}]});
 assert.deepEqual(rows.map(row=>row.symbol),['META']);
 const legacy=mergeEarningsCalendar(normalizeEodhdEarnings(calendar([event()]),start,end),[{symbol:'AAPL',date:'2026-10-23',epsActual:0},{symbol:'AAPL',date:'2026-10-23',epsEstimate:6}],start,end);assert.deepEqual(legacy,[]);
});
