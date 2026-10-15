import test from 'node:test';
import assert from 'node:assert/strict';
import {ASIA_MARKETS,normalizeAsiaSession,asiaSummary} from '../supabase/functions/daily-brief/asia.ts';
import {normalizeAsset,briefAiInput,type BriefData} from '../supabase/functions/daily-brief/data.ts';
import {renderBrief} from '../supabase/functions/daily-brief/render.ts';
const seconds=(s:string)=>Date.parse(s)/1000,market=ASIA_MARKETS[0];
function daily(at='2026-10-15T06:45Z',price=999){return {chart:{result:[{meta:{regularMarketTime:seconds(at),regularMarketPrice:price},timestamp:['2026-10-13T00:00Z','2026-10-14T00:00Z','2026-10-15T00:00Z'].map(seconds),indicators:{quote:[{close:[98,100,price]}]}}]}};}
function minute(){return {chart:{result:[{meta:{dataGranularity:'5m'},timestamp:['2026-10-15T04:50Z','2026-10-15T04:55Z','2026-10-15T05:00Z'].map(seconds),indicators:{quote:[{close:[101,102,999]}]}}]}};}
test('morning Asia uses only completed observations before the cutoff, not a later final close',()=>{
 const cutoff=Date.parse('2026-10-15T05:00Z'),a=normalizeAsiaSession(market,daily(),minute(),cutoff);
 assert.equal(a.status,'open');assert.equal(a.price,102);assert.equal(a.at,'2026-10-15T05:00:00.000Z');assert.equal(a.date,'2026-10-15');assert.equal(a.previousDate,'2026-10-14');assert.ok(Math.abs(a.change!-2)<1e-8);
 const summary=asiaSummary([a],cutoff);assert.ok(summary.includes('provisionales'));assert.ok(!summary.includes('ya cuentan con su cierre'));
});
test('Asia distinguishes confirmed closes, a pending close and the lunch break',()=>{
 assert.equal(normalizeAsiaSession(market,daily('2026-10-15T06:45Z',103),minute(),Date.parse('2026-10-15T07:00Z')).status,'closed');
 assert.equal(normalizeAsiaSession(market,daily('2026-10-15T06:10Z',103),minute(),Date.parse('2026-10-15T06:35Z')).status,'awaiting-close');
 assert.equal(normalizeAsiaSession(market,daily('2026-10-15T02:25Z',103),null,Date.parse('2026-10-15T02:45Z')).status,'pause');
 assert.equal(normalizeAsiaSession(ASIA_MARKETS[2],daily('2026-10-15T08:08Z',103),null,Date.parse('2026-10-15T09:00Z')).status,'closed');
});
test('KOSPI is still open at 07:00 Madrid in winter and old holiday quotes are dated explicitly',()=>{
 const kospi=ASIA_MARKETS[1],a=normalizeAsiaSession(kospi,daily('2026-10-15T06:10Z',103),null,Date.parse('2026-10-15T06:15Z'));
 assert.equal(a.status,'open');
 const holiday=normalizeAsiaSession(market,daily('2026-10-15T06:45Z',103),null,Date.parse('2026-10-17T05:00Z'));
 assert.equal(holiday.status,'previous');assert.equal(holiday.date,'2026-10-15');assert.ok(asiaSummary([holiday],Date.parse('2026-10-17T05:00Z')).includes('últimas sesiones'));
 assert.equal(normalizeAsiaSession(market,null,null,Date.parse('2026-10-15T05:00Z')).price,null);
});
test('opening Asia precedes the general summary, escapes prose and enters the existing AI input',()=>{
 const cutoff=Date.parse('2026-10-15T05:00Z'),a=normalizeAsiaSession(market,daily(),minute(),cutoff),base=normalizeAsset('SPY','S&P 500','ETF',null,cutoff);
 const data:BriefData={date:'2026-10-15',previousDay:'2026-10-14',cutoff:new Date(cutoff).toISOString(),generatedAt:new Date(cutoff).toISOString(),preview:true,assets:[base],watchlist:[],news:[],politics:[],treasury:[],lead:'General summary',takeaways:[],ai:false,asia:{cutoff:new Date(cutoff).toISOString(),summary:'Asia <script>unsafe</script>',markets:[a]}};
 const html=renderBrief(data);assert.ok(html.indexOf('id="asia"')<html.indexOf('id="resumen"'));assert.ok(html.includes('Asia &lt;script&gt;'));assert.ok(html.includes('En curso'));assert.ok(html.includes('JST'));assert.equal(briefAiInput(data).asia?.markets[0].price,102);
});
