import test from 'node:test';
import assert from 'node:assert/strict';
import {BRIEF_FUTURES,normalizeMorningFuture} from '../supabase/functions/daily-brief/futures.ts';
import {normalizeAsset,enrichBriefCovers,briefAiInput,applyBriefSummary,type BriefData} from '../supabase/functions/daily-brief/data.ts';
import {renderBrief} from '../supabase/functions/daily-brief/render.ts';
const time=(value:string)=>Date.parse(value)/1000;
const daily={chart:{result:[{meta:{currency:'USD',shortName:'E-mini S&P 500 Dec 26'},timestamp:['2026-10-15T04:00Z','2026-10-16T04:00Z','2026-10-19T04:00Z'].map(time),indicators:{quote:[{close:[98,100,999]}]}}]}};
const minute={chart:{result:[{meta:{dataGranularity:'5m',shortName:'E-mini S&P 500 Dec 26',regularMarketTime:time('2026-10-19T05:10Z'),regularMarketPrice:999},timestamp:['2026-10-19T04:50Z','2026-10-19T04:55Z','2026-10-19T05:00Z','2026-10-19T05:05Z'].map(time),indicators:{quote:[{close:[101,102,999,999]}]}}]}};
const cutoff=Date.parse('2026-10-19T05:00Z');
function edition():BriefData{return {date:'2026-10-19',previousDay:'2026-10-18',cutoff:new Date(cutoff).toISOString(),generatedAt:new Date(cutoff).toISOString(),preview:true,assets:[],watchlist:[],treasury:[],news:[],politics:[],lead:'Market overview',takeaways:[],ai:false};}
test('premarket futures retain completed observations at the Madrid cutoff and exclude the later daily close',()=>{
 const a=normalizeMorningFuture('ES=F','S&P 500',daily,minute,cutoff);
 assert.equal(a.status,'overnight');assert.equal(a.price,102);assert.equal(a.change,(102/100-1)*100);assert.equal(a.referenceDate,'2026-10-16');assert.equal(a.at,'2026-10-19T05:00:00.000Z');
 assert.equal(a.points.length,2);assert.ok(a.points.every(p=>Date.parse(p.date)<=cutoff&&p.value<999));assert.equal(BRIEF_FUTURES.length,4);
});
test('a weekend edition labels the last available close instead of a live overnight session',()=>{
 const a=normalizeMorningFuture('ES=F','S&P 500',daily,minute,Date.parse('2026-10-18T05:00Z'));
 assert.equal(a.status,'previous-close');assert.equal(a.date,'2026-10-16');assert.equal(a.price,100);assert.equal(a.at,null);assert.equal(a.referenceDate,'2026-10-15');
 const none=normalizeMorningFuture('RTY=F','Russell 2000',null,null,cutoff);assert.equal(none.status,'unavailable');assert.equal(none.price,null);
});
test('futures render before the summary with small renderer-compatible charts and no future data in the AI input',()=>{
 const data=edition();data.futures=[normalizeMorningFuture('ES=F','S&P 500',daily,minute,cutoff)];
 const ids:string[]=[],html=renderBrief(data,c=>{ids.push(c.id);return `<img src="cid:${c.id}@terminal" alt="chart"/>`;});
 assert.ok(html.indexOf('id="futuros"')<html.indexOf('id="resumen"'));assert.ok(html.includes('Negociación nocturna'));assert.ok(html.includes('cid:future-0@terminal'));assert.ok(!html.includes('999'));assert.ok(ids.includes('future-0'));
 const input=briefAiInput(data);assert.equal(input.futures?.[0].price,102);assert.ok(!('points' in input.futures![0]));
});
test('news, watchlist and geopolitics keep real covers with one resolution per article and reject logos',async()=>{
 const data=edition(),news={title:'A company announces results',source:'example',url:'https://www.cnbc.com/story',date:'2026-10-18',keyPoints:['La empresa presentó sus resultados.']};
 data.news=[{...news}];data.politics=[{...news}];data.watchlist=[{...normalizeAsset('SPY','SPY','ETF',null,cutoff),news:[{...news},{...news,url:'https://www.cnbc.com/another',image:'https://cdn.cnbc.com/company-logo.png'}]}];
 const calls:string[]=[];await enrichBriefCovers(data,async url=>{calls.push(url);return url.endsWith('another')?'https://cdn.cnbc.com/brand-logo.png':'https://cdn.cnbc.com/photos/real-story.jpg';});
 assert.equal(calls.length,2);assert.equal(data.watchlist[0].news[0].image,'https://cdn.cnbc.com/photos/real-story.jpg');assert.equal(data.watchlist[0].news[1].image,undefined);
 const html=renderBrief(data);assert.equal((html.match(/class="news-cover"/g)??[]).length,3);assert.ok(!html.includes('logo.png'));assert.ok(!html.includes('href="https://www.cnbc.com/story"'));
});
test('Asian editorial introduction accepts only supplied evidence and stays before futures and the general summary',()=>{
 const data=edition();data.asia={cutoff:data.cutoff,summary:'Asia muestra una evolución provisional.',markets:[{symbol:'^N225',name:'Nikkei 225',country:'Japón',timezone:'Asia/Tokyo',status:'open',date:'2026-10-19',price:100,change:1,at:'2026-10-19T04:55Z',previousClose:99,previousDate:'2026-10-16'}]};
 applyBriefSummary(data,{asiaIntro:{text:'La sesión de Japón conserva avances al corte, mientras continúa la negociación y queda pendiente su cierre.',evidence:['not-a-source']}});assert.equal(data.asia.editorial,undefined);
 applyBriefSummary(data,{asiaIntro:{text:'La sesión de Japón conserva avances al corte, mientras continúa la negociación y queda pendiente su cierre.',evidence:['^N225']}});assert.ok(data.asia.editorial?.includes('Japón'));assert.ok(renderBrief(data).indexOf('id="asia"')<renderBrief(data).indexOf('id="resumen"'));
});
