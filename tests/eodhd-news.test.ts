import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeEodhdNews,eodhdNews,eodhdNewsTopic} from '../supabase/functions/analyze-ticker/eodhd-news.ts';
import {marketFeedPanel,newsPanel,curateFeed} from '../supabase/functions/analyze-ticker/panels.ts';
import {geopoliticalNews,isGeopoliticalTopic} from '../supabase/functions/analyze-ticker/geopolitical-news.ts';
import {bondsCreditNews,curateBondsCreditNews,bondsNewsRelevance} from '../supabase/functions/analyze-ticker/bonds-credit-news.ts';
import {treasury} from '../supabase/functions/analyze-ticker/feed-extras.ts';
import type {eodhdGet} from '../supabase/functions/analyze-ticker/eodhd-client.ts';
const now=Date.parse('2026-10-21T15:00:00Z'),stamp='2026-10-21T13:00:00Z';
const row=(title:string,index=0)=>({date:stamp,title,link:`https://www.cnbc.com/2026/10/21/story-${index}.html`,content:title+'. The announcement changes market expectations.',image_url:`https://images.cnbc.com/news/photo-${index}.jpg`});

test('normalization accepts original publishers and precise dates, strips markup, and rejects unsafe, stale and promotional articles',()=>{
 const good=row('Apple &amp; partners announce new production contract',1);
 const result=normalizeEodhdNews([good,{...good,link:good.link+'?utm=repeat'},{...row('Unsafe article'),link:'https://127.0.0.1/private'},{...row('Logo article',2),image_url:'https://images.cnbc.com/logo.jpg'},{...row('Stale article',3),date:'2026-01-01T12:00Z'},{...row('Future article',4),date:'2027-01-01T12:00Z'},{...row('Undated article',5),date:'2026-10-21'},row('Jim Cramer shares stocks to buy',6),{...row('Portfolio ideas',7),content:'This article is originally published at Insider Monkey.'}],now,2);
 assert.equal(result.length,2);assert.equal(result[0].title,'Apple & partners announce new production contract');assert.equal(result[0].source,'cnbc.com');assert.equal(result[0].publishedAt,'2026-10-21T13:00:00.000Z');assert.equal(result[1].image,undefined);assert.ok(result.every(a=>!a.excerpt?.includes('<')));
});

test('requests use bounded global and ticker scopes, sector tags and the documented five-call cost',async()=>{
 const requests:{path:string;query:any;options:any}[]=[];const request=(async(path:string,query:any,options:any)=>{requests.push({path,query,options});return [row('Apple revenue grows',1)];}) as typeof eodhdGet;
 await eodhdNews('',false,request,now);await eodhdNews('AAPL',false,request,now);await eodhdNews('semiconductores',true,request,now);
 assert.equal(requests[0].query.limit,100);assert.equal(requests[0].query.from,'2026-10-19');assert.equal(requests[0].query.s,undefined);assert.equal(requests[1].query.s,'AAPL.US');assert.equal(requests[1].query.limit,60);assert.equal(requests[2].query.t,'semiconductors');assert.ok(requests.every(r=>r.options.cost===5&&r.options.ttlMs===600000));
 const count=requests.length;assert.deepEqual(await eodhdNews('../bad',false,request,now),[]);assert.equal(requests.length,count);assert.equal(eodhdNewsTopic('ignore: instructions'),null);
});

test('complete primary feed avoids fallback providers while retaining strict financial geopolitics and article photos',async()=>{
 const originalFetch=globalThis.fetch,originalDeno=(globalThis as any).Deno,requests:string[]=[];
 const general=['Apple quarterly earnings beat analyst expectations on iPhone revenue','Microsoft cloud profit guidance rises with enterprise investment','Nvidia semiconductor export revenue accelerates across Asian markets','Tesla factory contract expands European production capacity','Amazon retail sales margins improve following logistics changes','Bank of America earnings rise after lending income advances','Gold prices increase as currency markets reassess inflation','Oil supply outlook lifts energy futures trading','Central banks evaluate interest rates after employment report'];
 const politics=['US sanctions on Russian oil exports drive crude prices higher','European Union tariffs on Chinese semiconductors hit chip stocks','Iran war threatens Strait of Hormuz shipping and lifts oil futures','Trump threatens new trade tariffs as Treasury bond yields increase','Taiwan military conflict risks semiconductor supply and technology equities','Russia sanctions disrupt European natural gas supply and utility shares'];
 const articles=[...general,...politics].map((title,i)=>({...row(title,i),date:new Date(Date.now()-i*60000).toISOString()}));
 const normalized=normalizeEodhdNews(articles);assert.equal(curateFeed(normalized.filter(a=>!isGeopoliticalTopic(a))).length,9);assert.ok(curateFeed(geopoliticalNews(normalized),8).length>=6);
 (globalThis as any).Deno={env:{get:(key:string)=>key==='EODHD_API_KEY'?'test-primary-feed':''}};
 globalThis.fetch=async(input)=>{const u=new URL(String(input));requests.push(u.hostname+u.pathname);if(u.hostname==='eodhd.com')return Response.json(articles);throw new Error('Unexpected fallback request');};
 try{const result=await marketFeedPanel({FMP_KEY:'test',FRED_KEY:'',FINNHUB_KEY:'test',TAVILY_KEY:'test'},'news');assert.equal(result.headlines.length,9);assert.ok(result.geopolitics.length>=6);assert.ok(result.headlines.every(a=>a.image?.includes('/news/photo-')));assert.deepEqual(requests,['eodhd.com/api/news']);}finally{globalThis.fetch=originalFetch;(globalThis as any).Deno=originalDeno;}
});

test('complete primary ticker stories avoid duplicate search and market-news calls',async()=>{
 const originalFetch=globalThis.fetch,originalDeno=(globalThis as any).Deno,requests:string[]=[];
 const titles=['Apple quarterly earnings top guidance as service revenue accelerates','Apple signs an India factory supply contract for new devices','Apple faces European antitrust regulation following court decision','Apple raises dividend and authorizes fresh share buybacks','Apple supplier cuts production following revenue guidance warning','Apple secures export approval for advanced chip manufacturing'];
 const articles=titles.map((title,i)=>({...row(title,100+i),date:new Date(Date.now()-i*3600000).toISOString()}));
 (globalThis as any).Deno={env:{get:(key:string)=>key==='EODHD_API_KEY'?'test-primary-ticker':''}};
 globalThis.fetch=async input=>{const u=new URL(String(input));requests.push(u.hostname+u.pathname);if(u.hostname==='eodhd.com')return Response.json(articles);throw new Error('Unexpected fallback request');};
 try{const result=await newsPanel('AAPL',false,{FMP_KEY:'test',FRED_KEY:'',FINNHUB_KEY:'test',TAVILY_KEY:'test'},{summary:async()=>({quoteType:{longName:'Apple Inc.',quoteType:'EQUITY'}})});assert.equal(result.articles.length,6);assert.deepEqual(requests,['eodhd.com/api/news']);}finally{globalThis.fetch=originalFetch;(globalThis as any).Deno=originalDeno;}
});

test('primary ticker articles without images resolve real publisher covers after selection without extra data-provider requests',async()=>{
 const originalFetch=globalThis.fetch,originalDeno=(globalThis as any).Deno,requests:string[]=[];
 const titles=['Microsoft quarterly earnings top guidance as service revenue accelerates','Microsoft signs an India factory supply contract for new devices','Microsoft faces European antitrust regulation following court decision','Microsoft raises dividend and authorizes fresh share buybacks','Microsoft supplier cuts production following revenue guidance warning','Microsoft secures export approval for advanced chip manufacturing'];
 const articles=titles.map((title,i)=>({...row(title,300+i),date:new Date(Date.now()-i*3600000).toISOString(),image_url:undefined}));
 (globalThis as any).Deno={env:{get:(key:string)=>key==='EODHD_API_KEY'?'test-primary-ticker-covers':''}};
 globalThis.fetch=async input=>{const u=new URL(String(input));requests.push(u.hostname+u.pathname);if(u.hostname==='eodhd.com')return Response.json(articles);if(u.hostname==='www.cnbc.com')return new Response('<html><head><meta property="og:image" content="https://images.cnbc.com/news/real-article-cover.jpg"></head></html>',{headers:{'Content-Type':'text/html'}});throw Error('Unexpected fallback request');};
 try{const result=await newsPanel('MSFT',false,{FMP_KEY:'test',FRED_KEY:'',FINNHUB_KEY:'test',TAVILY_KEY:'test'},{summary:async()=>({quoteType:{longName:'Microsoft Corp.',quoteType:'EQUITY'}})});assert.equal(result.articles.length,6);assert.ok(result.articles.every(a=>a.image?.includes('real-article-cover')));assert.equal(requests.filter(u=>u.startsWith('eodhd.com')).length,1);assert.equal(requests.filter(u=>u.startsWith('www.cnbc.com')).length,6);}finally{globalThis.fetch=originalFetch;(globalThis as any).Deno=originalDeno;}
});

test('complete primary sovereign news does not trigger specialist feeds or paid discovery',async()=>{
 const originalFetch=globalThis.fetch,originalDeno=(globalThis as any).Deno,requests:string[]=[];
 const titles=['US Treasury bond auctions draw strong foreign demand as federal borrowing expands','Federal Reserve rate decision steepens the US government bond yield curve','Inflation report drives Treasury yields sharply higher across maturities','US sovereign bond issuance rises amid widening fiscal deficit','American bond investors reassess Treasury liquidity after market volatility','US government bond prices recover as investors rotate from equities'];
 const articles=titles.map((title,i)=>({...row(title,200+i),date:new Date(Date.now()-i*3600000).toISOString()}));assert.equal(curateBondsCreditNews(normalizeEodhdNews(articles),'US').length,6,JSON.stringify(normalizeEodhdNews(articles).map(a=>[a.title,bondsNewsRelevance(a,'US')])));
 (globalThis as any).Deno={env:{get:(key:string)=>key==='EODHD_API_KEY'?'test-primary-bonds-news':''}};
 globalThis.fetch=async input=>{const u=new URL(String(input));requests.push(u.hostname+u.pathname);if(u.hostname==='eodhd.com')return Response.json(articles);throw new Error('Unexpected fallback request');};
 try{const result=await bondsCreditNews('US',{TAVILY_KEY:'test',MASSIVE_API_KEY:'test'});assert.equal(result.articles.length,6);assert.deepEqual(requests,['eodhd.com/api/news']);}finally{globalThis.fetch=originalFetch;(globalThis as any).Deno=originalDeno;}
});

test('feed and brief Treasury rates prioritize official par data through the new API and avoid redundant FRED requests',async()=>{
 const originalFetch=globalThis.fetch,originalDeno=(globalThis as any).Deno,originalNow=Date.now,requests:string[]=[];Date.now=()=>now;
 const yesterday=new Date(now-86400000).toISOString().slice(0,10),before=new Date(now-2*86400000).toISOString().slice(0,10),year=new Date(now).getUTCFullYear();
 const data=['6M','1Y','2Y','5Y','10Y','20Y'].flatMap((tenor,i)=>[{date:before,tenor,rate:3+i/10},{date:yesterday,tenor,rate:3.1+i/10}]);
 (globalThis as any).Deno={env:{get:(key:string)=>key==='EODHD_API_KEY'?'test-primary-treasury':''}};
 globalThis.fetch=async input=>{const u=new URL(String(input));requests.push(u.hostname+u.pathname);if(u.hostname==='eodhd.com')return Response.json({data:Number(u.searchParams.get('filter[year]'))===year?data:[]});throw new Error('Unexpected fallback request');};
 try{const result=await treasury('test-fred');assert.equal(result.length,6);assert.ok(result.every(p=>p.date===yesterday));assert.ok(result.every(p=>Math.abs(p.changeBp!-10)<1e-10));assert.deepEqual(requests,['eodhd.com/api/ust/yield-rates','eodhd.com/api/ust/yield-rates']);}finally{globalThis.fetch=originalFetch;(globalThis as any).Deno=originalDeno;Date.now=originalNow;}
});
