import {test} from 'node:test';
import assert from 'node:assert/strict';
import {briefWindow,zonedTime,normalizeAsset,datedNews,marketNews,watchNewsFor,marketLead,watchContext,MARKETS,briefAiInput,applyBriefSummary,writeBriefSummary,type BriefData} from '../supabase/functions/daily-brief/data.ts';
import {deliveryTime,editionDate,BRIEF_MODEL,BRIEF_OUTPUT_TOKENS} from '../supabase/functions/daily-brief/preferences.ts';
import {chartSvg,renderBrief,renderMarketPages} from '../supabase/functions/daily-brief/render.ts';
import {extractCover,publisherUrl} from '../supabase/functions/analyze-ticker/news-covers.ts';
test('morning brief follows Madrid daylight saving and yesterday rather than subtracting 24 hours',()=>{
 assert.equal(new Date(zonedTime('2026-10-12','07:00')).toISOString(),'2026-10-12T05:00:00.000Z');
 assert.equal(new Date(zonedTime('2026-10-26','07:00')).toISOString(),'2026-10-26T06:00:00.000Z');
 assert.equal(new Date(zonedTime('2026-03-29','07:00')).toISOString(),'2026-03-29T05:00:00.000Z');
 const w=briefWindow(Date.parse('2026-03-29T04:55Z'));assert.equal(w.previousDay,'2026-03-28');assert.equal(new Date(w.start).toISOString(),'2026-03-27T23:00:00.000Z');assert.equal(w.cutoff,Date.parse('2026-03-29T04:55Z'));
 assert.equal(new Date(zonedTime('2026-03-29','02:30')).toISOString(),'2026-03-29T01:30:00.000Z');
 assert.equal(new Date(zonedTime('2026-10-25','02:30')).toISOString(),'2026-10-25T01:30:00.000Z');
 const midnight=briefWindow(Date.parse('2026-10-12T21:55Z'),false,'00:00','2026-10-13');assert.equal(midnight.date,'2026-10-13');assert.equal(midnight.previousDay,'2026-10-12');assert.equal(midnight.cutoff,Date.parse('2026-10-12T21:55Z'));
});

function edition():BriefData{return {date:'2026-10-13',previousDay:'2026-10-12',cutoff:'2026-10-13T05:00Z',generatedAt:'2026-10-13T04:55Z',preview:true,assets:MARKETS.map(([symbol,name,group])=>({...normalizeAsset(symbol,name,group,null,0),date:'2026-10-12',close:100,points:[{date:'2026-10-09',value:99},{date:'2026-10-12',value:100}]})),watchlist:[],treasury:[2,5,10,20].map(years=>({years,yield:4,date:'2026-10-12',changeBp:0})),news:[],politics:[{title:'Oil supply and ceasefire talks',source:'test',url:'https://www.reuters.com/world/story',date:'2026-10-12',publishedAt:'2026-10-12T10:00Z',excerpt:'Energy supply talks continue.',image:'https://www.reuters.com/photos/story.jpg'}],lead:'Calculated summary.',takeaways:[],ai:false};}

test('general markets occupy two separate compact sheets, preserving every asset and the Treasury curve',()=>{
 const data=edition(),before=JSON.stringify(data.watchlist),charts:string[]=[];
 const pages=renderMarketPages(data,c=>{charts.push(c.id);assert.equal(c.height,120);return '<svg></svg>';});
 assert.equal((pages.match(/data-market-page=/g)??[]).length,2);assert.equal((pages.match(/class="market-card/g)??[]).length,20);
 for(let i=0;i<MARKETS.length;i++)assert.equal((pages.match(new RegExp(`id="asset-market-${i}"`,'g'))??[]).length,1);
 assert.equal(charts.length,20);assert.equal(JSON.stringify(data.watchlist),before);
 const html=renderBrief(data);assert.ok(html.includes('width="146" height="98"'));assert.ok(!html.includes('width="700"'));assert.ok(html.indexOf('id="entorno"')>html.indexOf('id="politica"'));assert.ok(html.includes('@page{size:A4'));
});

test('brief news has nonclickable key points, while contents and terminal navigation remain usable',()=>{
 const data=edition();data.politics[0]={...data.politics[0],title:'Oil supply and ceasefire talks – Reuters',keyPoints:['Se mantienen las conversaciones sobre suministro.','No se ha confirmado un acuerdo definitivo.']};
 const html=renderBrief(data),article=html.match(/<article class="news-item">([\s\S]*?)<\/article>/)?.[1]??'';
 assert.ok(article.includes('class="news-points"'));assert.ok(article.includes('No se ha confirmado un acuerdo definitivo.'));assert.ok(article.includes('class="news-cover"'));
 assert.ok(!/<a\b|href=|– Reuters/.test(article));assert.ok(!html.includes('href="https://www.reuters.com/world/story"'));
 assert.ok(html.includes('href="#politica"'));assert.ok(html.includes('href="https://sftmvpppp.vercel.app/"'));
 assert.equal(data.politics[0].url,'https://www.reuters.com/world/story');
});

test('AI input deduplicates articles and excludes chart and image payloads; geopolitical text requires supplied evidence',()=>{
 const data=edition(),article=data.politics[0];data.news=[article];
 const input=briefAiInput(data);assert.equal(input.articles.length,1);assert.deepEqual(input.politics,[article.url]);assert.ok(!JSON.stringify(input).includes('photos/story.jpg'));assert.ok(!JSON.stringify(input).includes('points'));
 const paragraph=Array.from({length:60},()=> 'contexto').join(' ');
 applyBriefSummary(data,{geopoliticalSummary:{paragraphs:[paragraph,paragraph],evidence:['https://invented.example/story']}});assert.ok(!data.geopoliticalSummary?.evidence.includes('https://invented.example/story'));
 applyBriefSummary(data,{geopoliticalSummary:{paragraphs:[paragraph,paragraph],evidence:[article.url]}});assert.deepEqual(data.geopoliticalSummary?.paragraphs,[paragraph,paragraph]);assert.equal(data.ai,true);
});

test('brief uses one bounded Gemini generation, without silently downgrading on provider unavailability',async()=>{
 const data=edition(),calls:{url:string;body:any}[]=[],paragraph=Array.from({length:60},()=> 'contexto').join(' ');
 const fetcher:typeof fetch=async(url,init)=>{calls.push({url:String(url),body:JSON.parse(init!.body as string)});return new Response(JSON.stringify({usageMetadata:{promptTokenCount:1000,candidatesTokenCount:500,thoughtsTokenCount:20},candidates:[{content:{parts:[{text:JSON.stringify({geopoliticalSummary:{paragraphs:[paragraph,paragraph],evidence:[data.politics[0].url]}})}]}}]}));};
 await writeBriefSummary(data,'test-key',fetcher);assert.equal(calls.length,1);assert.ok(calls[0].url.includes(BRIEF_MODEL));assert.equal(calls[0].body.generationConfig.maxOutputTokens,BRIEF_OUTPUT_TOKENS);assert.deepEqual(calls[0].body.generationConfig.thinkingConfig,{thinkingLevel:'medium'});assert.equal(data.model,BRIEF_MODEL);assert.equal(data.usage?.estimatedUsd,.00824);
 let attempts=0;const fallback=edition();await writeBriefSummary(fallback,'test-key',async(url,init)=>++attempts===1?new Response('{}',{status:429}):fetcher(url,init));assert.equal(attempts,1);assert.equal(fallback.model,undefined);
 let timeouts=0;await writeBriefSummary(edition(),'test-key',async()=>{timeouts++;throw new Error('timeout');});assert.equal(timeouts,1);
});
test('brief separates incomplete sessions from close history and does not fabricate risk metrics',()=>{
 const cutoff=Date.parse('2026-10-12T05:00Z');
 const chart={chart:{result:[{meta:{currency:'USD',exchangeTimezoneName:'America/New_York',regularMarketPrice:105,regularMarketTime:Date.parse('2026-10-12T04:30Z')/1000},timestamp:['2026-10-08T13:30Z','2026-10-09T13:30Z','2026-10-12T13:30Z'].map(t=>Date.parse(t)/1000),indicators:{quote:[{open:[100,101,999],high:[101,103,999],low:[99,100,999],close:[100,102,999],volume:[100,200,900]}],adjclose:[{adjclose:[50,51,999]}]}}]}};
 const a=normalizeAsset('AAPL','Apple','Watchlist',chart,cutoff);assert.equal(a.close,102);assert.equal(a.date,'2026-10-09');assert.ok(Math.abs(a.change!-2)<1e-8);assert.equal(a.vol20,null);assert.equal(a.week,null);assert.equal(a.trend,'Sin histórico suficiente');assert.equal(a.latest?.price,105);
 const none=normalizeAsset('MISSING','Missing','Watchlist',null,cutoff);assert.equal(none.close,null);assert.equal(none.latest,null);
 chart.chart.result[0].meta.currentTradingPeriod={regular:{end:Date.parse('2026-10-12T20:00Z')/1000}};
 assert.equal(normalizeAsset('AAPL','Apple','Watchlist',chart,Date.parse('2026-10-12T20:30Z')).date,'2026-10-12');
});

test('editable time is strict and watchlist comparisons require aligned dates and enough observations',()=>{
 for(const time of ['00:00','07:00','23:59'])assert.equal(deliveryTime(time),time);
 for(const time of ['7:00','24:00','12:60','07:00:00',null,{}])assert.equal(deliveryTime(time),null);
 assert.equal(editionDate('2026-02-30'),false);
 const a={...normalizeAsset('NVDA','Nvidia','Watchlist',null,0),date:'2026-01-21',week:5,month:10,adjustedPoints:Array.from({length:21},(_,i)=>({date:`2026-01-${String(i+1).padStart(2,'0')}`,value:100+i+i*i/100}))};
 const b={...a,symbol:'SPY',week:2,month:4};
 assert.equal(watchContext(a,b).relative5,3);assert.equal(watchContext(a,b).relative21,6);assert.ok(Math.abs(watchContext(a,b).correlation20!-1)<1e-9);
 assert.equal(watchContext(a,{...b,date:'2026-01-20'}).relative21,null);
 assert.equal(watchContext(a,{...b,adjustedPoints:b.adjustedPoints.slice(1)}).correlation20,null);
});
test('brief only retains news published within the information window and uses article-specific photos',()=>{
 const start=Date.parse('2026-10-11T00:00Z'),cutoff=Date.parse('2026-10-12T05:00Z'),a={title:'Oil supplies change after ceasefire',url:'https://euronews.com/a',date:'2026-10-11',publishedAt:'2026-10-11T10:00Z',source:'test'};
 assert.equal(datedNews([a,a,{...a,url:'https://bbc.com/b',publishedAt:'2026-10-12T06:00Z'},{...a,url:'https://bbc.com/c',publishedAt:undefined}],start,cutoff).length,1);
 assert.equal(publisherUrl('https://www.euronews.com/news/a'),true);assert.equal(publisherUrl('https://theguardian.com.evil.test/a'),false);
 assert.equal(extractCover('<script type="application/ld+json">{"@type":"NewsArticle","image":{"url":"/photos/story.jpg"}}</script>','https://www.euronews.com/a'),'https://www.euronews.com/photos/story.jpg');
 assert.equal(extractCover('<script type="application/ld+json">{"@type":"Organization","image":"/logo.jpg"}</script>','https://www.bbc.com/a'),undefined);
 assert.equal(marketNews([{...a,title:'New market research projects expansion',url:'https://globenewswire.com/a'},{...a,title:'Parenting tips during market uncertainty',url:'https://cnbc.com/make-it/a'},a]).length,1);
 assert.equal(marketNews([{...a,title:'Fire destroys covered food market in Paris'}]).length,0);
 assert.equal(datedNews([{...a,title:'MSFT.O - | Stock Price & Latest News',url:'https://reuters.com/markets/companies/MSFT.O/financials/income-annual'}],start,cutoff).length,0);
 const stock=normalizeAsset('AAPL','Apple Inc.','Watchlist',null,cutoff);
 assert.deepEqual(watchNewsFor([{...a,title:'Apple announces new products'}, {...a,title:'Investors heavily search Apple',url:'https://bbc.com/b'},{...a,title:'Oil rises after ceasefire',url:'https://bbc.com/c'}],stock,start,cutoff).map(n=>n.title),['Apple announces new products']);
});
test('brief renders escaped content, real periods and no fake curve when dates differ',()=>{
 const data:BriefData={date:'2026-10-12',previousDay:'2026-10-11',cutoff:'2026-10-12T05:00Z',generatedAt:'2026-10-12T04:55Z',preview:true,assets:[],watchlist:[],treasury:[2,5,10,20].map((years,i)=>({years,yield:4,date:i===0?'2026-10-08':'2026-10-09',changeBp:0})),news:[],politics:[],lead:'<script>alert(1)</script>',takeaways:[],ai:false};
 const html=renderBrief(data);assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('No hay una fecha común'));assert.ok(!html.includes('Curva del Tesoro: rendimiento por vencimiento'));
 assert.ok(!marketLead(data).includes('puntos básicos'));
 const inverted={...data,treasury:[{years:2,yield:5,date:'2026-10-09',changeBp:0},{years:10,yield:4,date:'2026-10-09',changeBp:0}]};assert.ok(marketLead(inverted).includes('-100 puntos básicos respecto'));
 const svg=chartSvg({id:'a',title:'Example',points:[{date:'a',value:100},{date:'b',value:100}],color:'#178877'});assert.ok(svg.includes('<svg'));assert.ok(!svg.includes('NaN'));
});
