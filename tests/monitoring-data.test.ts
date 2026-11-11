import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectMonitorSnapshot,monitorSourceUrl,normalizeMonitorNews} from '../supabase/functions/analyze-ticker/monitoring-data.ts';
import {normalizeRegularQuote} from '../supabase/functions/analyze-ticker/regular-quote.ts';
import {buildEarningsPreview} from '../supabase/functions/analyze-ticker/earnings-preview.ts';
const now=Date.UTC(2026,10,11,15),at=new Date(now).toISOString();
const chart=()=>({chart:{result:[{meta:{symbol:'GOOGL',instrumentType:'EQUITY',currency:'USD',longName:'Alphabet Inc.',exchangeTimezoneName:'America/New_York',regularMarketPrice:210,regularMarketTime:now/1000-60,currentTradingPeriod:{regular:{start:Date.UTC(2026,10,11,14,30)/1000,end:Date.UTC(2026,10,11,21)/1000}}},timestamp:[Date.UTC(2026,10,9,14,30)/1000,Date.UTC(2026,10,10,14,30)/1000],indicators:{quote:[{close:[198,200]}]}}]}});
const noCalendar=()=>Promise.resolve({symbol:'GOOGL',next:{date:null},history:[]} as any);
test('monitor source links exclude secrets, credentials and private/internal locations',()=>{
 for(const s of ['http://example.com','javascript:alert(1)','https://user:pass@example.com','https://127.0.0.1/','https://x.supabase.co/','https://example.com/?api_key=abc','https://example.com/?redirect=api%255Ftoken%253Dx'])assert.equal(monitorSourceUrl(s),null);
 assert.equal(monitorSourceUrl('https://example.com/news?utm_source=feed#x'),'https://example.com/news');
});
test('source-bound news is dated, relevant and deduplicated without promoting speculative headlines',()=>{
 const a={title:'Alphabet publica resultados trimestrales',url:'https://example.com/a',source:'Medio',date:'2026-11-11',publishedAt:at,excerpt:'Resultados publicados por Alphabet.'};
 assert.equal(normalizeMonitorNews([a,{...a,url:a.url+'?utm_source=rss'},{...a,url:'https://other.example/a'},{...a,title:'Prediction: stocks to buy'},{...a,title:'Resultados de otra compañía',excerpt:'Nada sobre el activo'}],'GOOGL','Alphabet',now).length,1);
});
test('daily fundamentals are reused; missed quote refresh retains real dates instead of masquerading as live',async()=>{
 let reads=0;const deps={now:()=>now,fundamentals:async()=>{reads++;return null;},summary:async()=>null,chart:async()=>chart(),news:async()=>[],calendar:noCalendar};
 const first=await collectMonitorSnapshot('GOOGL',null,{},deps);assert.equal(first.metrics.price?.value,210);assert.ok(Math.abs(first.metrics.changePct!.value!-5)<1e-10);assert.equal(first.metrics.price?.asOf,new Date(now-60000).toISOString());assert.equal(first.metrics.pe,undefined);
 const next=await collectMonitorSnapshot('GOOGL',first,{}, {...deps,now:()=>now+16*60000,chart:async()=>null});assert.equal(reads,1);assert.equal(next.metrics.price?.asOf,first.metrics.price?.asOf);assert.equal(next.metrics.price?.value,210);assert.ok(next.coverage.some(s=>s.includes('Cotización no recuperada')));
});
test('dated fundamental forecast period and same-day earnings countdown preserve real units',async()=>{
 const raw={General:{Code:'GOOGL',Type:'Common Stock',Name:'Alphabet',CurrencyCode:'USD',UpdatedAt:'2026-11-10'},Highlights:{MostRecentQuarter:'2026-09-30',QuarterlyRevenueGrowthYOY:.15},Valuation:{TrailingPE:20},Earnings:{Trend:{Quarterly:{'2026-12-31':{date:'2026-12-31',period:'0q',earningsEstimateAvg:'3.5'}}}}};
 const s=await collectMonitorSnapshot('GOOGL',null,{}, {now:()=>now,fundamentals:async()=>raw,chart:async()=>chart(),news:async()=>[],calendar:async()=>({next:{date:'2026-11-11',provisional:false,session:'Después del cierre',period:'2026-09-30',eps:{mean:3.2,currency:'USD'}}} as any)});
 assert.equal(s.metrics.earningsWithinDays?.value,0);assert.equal(s.metrics.revenueGrowthPct?.value,15);assert.equal(s.metrics.epsEstimate?.period,'2026-09-30');assert.equal(s.metrics.epsEstimate?.currency,'USD');assert.equal(s.calendar[0].confirmed,true);
});
test('cross-ticker quotes cannot become a monitoring observation',async()=>{
 const wrong=chart();wrong.chart.result[0].meta.symbol='AAPL';
 await assert.rejects(collectMonitorSnapshot('GOOGL',null,{}, {now:()=>now,fundamentals:async()=>null,summary:async()=>null,chart:async()=>wrong,news:async()=>[],calendar:noCalendar}),/MONITOR_DATA_UNAVAILABLE/);
});
test('failed daily enrichment retries after one hour instead of hiding missing coverage for a day',async()=>{
 let reads=0;const deps={now:()=>now,fundamentals:async()=>{reads++;return null;},summary:async()=>null,chart:async()=>chart(),news:async()=>[],calendar:noCalendar};
 const first=await collectMonitorSnapshot('GOOGL',null,{},deps);assert.equal(first.fundamentalsAt,null);
 await collectMonitorSnapshot('GOOGL',first,{}, {...deps,now:()=>now+3600001});assert.equal(reads,2);
});
test('dates remain ISO when the runtime locale formats Canadian dates differently',()=>{
 const descriptor=Object.getOwnPropertyDescriptor(Intl.DateTimeFormat.prototype,'format')!;
 Object.defineProperty(Intl.DateTimeFormat.prototype,'format',{configurable:true,get(){return ()=> '11/10/2026';}});
 try{const q=normalizeRegularQuote('GOOGL',chart(),Date.UTC(2026,10,11,23));assert.equal(q.date,'2026-11-10');assert.doesNotThrow(()=>buildEarningsPreview(null,'GOOGL',null,[],now));}finally{Object.defineProperty(Intl.DateTimeFormat.prototype,'format',descriptor);}
});
